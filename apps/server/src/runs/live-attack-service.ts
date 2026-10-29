import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type { BudgetService } from "../budget/service.js";
import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../persistence/database.js";
import { initializeRunSchema } from "../persistence/schema.js";
import {
  MetaAttackerProvider,
  type MetaAttackerTurnRecord,
} from "../providers/meta-attacker.js";
import type { Policy } from "../../../../packages/policy/src/schema.js";
import { parsePolicy } from "../../../../packages/policy/src/schema.js";
import type { Action } from "../../../../packages/engine/src/actions.js";
import { canonicalHash } from "../../../../packages/engine/src/canonical-hash.js";
import { createBottleReturnState } from "../../../../packages/engine/src/scenario.js";
import {
  ATTACKER_LIMITS,
  BoundedAttackerSession,
  runBoundedAttacker,
  type AttackerExecutionAudit,
  type AttackerProvider,
  type AttackerSearchResult,
} from "./agent.js";
import { RunService } from "./service.js";
import { emptyVerification } from "./verifier.js";

interface AttackProvider extends AttackerProvider {
  readonly turns: readonly MetaAttackerTurnRecord[];
}

type AttackProviderFactory = (searchId: string) => AttackProvider;

export interface LiveAttackResult {
  readonly searchId: string;
  readonly runId: string | null;
  readonly provenance: "live_model";
  readonly modelId: string;
  readonly replayed: boolean;
  readonly verification: AttackerSearchResult;
  readonly turns: readonly {
    readonly sequence: number;
    readonly strategySummary: string;
    readonly toolNames: readonly string[];
  }[];
  readonly usage: {
    readonly requests: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
    readonly actualUsd: number;
  };
  readonly report: {
    readonly outcome:
      | "verified_exploit"
      | "candidate_rejected"
      | "search_completed"
      | "search_interrupted";
    readonly reason: string;
    readonly requestsUsed: number;
    readonly trialsCompleted: number;
    readonly actionsTested: number;
    readonly attemptedTraces: readonly {
      readonly request: number;
      readonly trial: number;
      readonly kind: "trial" | "candidate";
      readonly hypothesis: string;
      readonly actions: readonly Action[];
    }[];
  };
}

interface SearchRow {
  readonly policy_hash: string | null;
  readonly status: "claimed" | "completed" | "incomplete";
  readonly result_json: string | null;
}

export class LiveAttackServiceError extends Error {
  constructor(
    readonly code:
      | "IDEMPOTENCY_KEY_REUSED"
      | "ATTACK_ALREADY_RUNNING"
      | "ATTACK_ALREADY_ATTEMPTED"
      | "PROVIDER_BUSY"
      | "LIVE_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "LiveAttackServiceError";
  }
}

function publicTurns(turns: readonly MetaAttackerTurnRecord[]): LiveAttackResult["turns"] {
  return turns.map((turn) => ({
    sequence: turn.sequence,
    strategySummary: turn.strategySummary,
    toolNames: turn.toolCalls.map((call) => call.name),
  }));
}

function usage(turns: readonly MetaAttackerTurnRecord[]): LiveAttackResult["usage"] {
  const totals = turns.reduce(
    (sum, turn) => ({
      promptTokens: sum.promptTokens + turn.usage.promptTokens,
      completionTokens: sum.completionTokens + turn.usage.completionTokens,
      totalTokens: sum.totalTokens + turn.usage.totalTokens,
      actualUsd: sum.actualUsd + turn.usage.actualUsd,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, actualUsd: 0 },
  );
  return {
    requests: turns.length,
    ...totals,
    actualUsd: Number(totals.actualUsd.toFixed(6)),
  };
}

function searchReport(
  verification: AttackerSearchResult,
  audit: AttackerExecutionAudit,
): LiveAttackResult["report"] {
  const common = {
    requestsUsed: verification.requestsUsed,
    trialsCompleted: audit.trialsCompleted,
    actionsTested: audit.actionsTested,
    attemptedTraces: audit.attemptedTraces,
  };
  switch (verification.status) {
    case "exploit_verified":
      return {
        ...common,
        outcome: "verified_exploit",
        reason: `Host replay verified ${verification.excessReward} unintended reward points across ${verification.verifiedActionCount} actions.`,
      };
    case "no_exploit_in_submitted_trace":
      return {
        ...common,
        outcome: "candidate_rejected",
        reason: `Host replay found ${verification.excessReward} unintended reward points, so the submitted candidate did not meet the exploit definition.`,
      };
    case "candidate_invalid":
      return {
        ...common,
        outcome: "candidate_rejected",
        reason: "The submitted candidate failed host action validation and was not replayed.",
      };
    case "no_exploit_found_within_budget":
      return {
        ...common,
        outcome: "search_completed",
        reason: "The bounded search completed; no exploit was found within the stated budget.",
      };
    case "run_incomplete":
      const interruptionReasons = {
        cancelled: "The host cancelled the bounded search before completion.",
        deadline_exceeded: "The bounded search reached its two-minute deadline before completion.",
        request_timeout: "A provider request timed out before the bounded search completed.",
        provider_error: "The provider API request failed before the bounded search completed.",
        malformed_response: "The provider returned malformed output that the host refused to execute.",
      } as const;
      return {
        ...common,
        outcome: "search_interrupted",
        reason: verification.interruptionReason
          ? interruptionReasons[verification.interruptionReason]
          : "The bounded search stopped before completion.",
      };
  }
}

export class LiveAttackService {
  readonly #database: AppDatabase;
  readonly #runs: RunService;
  readonly #config: ServerConfig;
  readonly #createProvider: AttackProviderFactory;
  #inFlight = false;

  constructor(
    database: AppDatabase,
    runs: RunService,
    config: ServerConfig,
    budget: BudgetService,
    createProvider: AttackProviderFactory = (searchId) =>
      new MetaAttackerProvider(config, budget, searchId),
  ) {
    this.#database = database;
    this.#runs = runs;
    this.#config = config;
    this.#createProvider = createProvider;
    initializeRunSchema(database);
  }

  async run(inputPolicy: Policy, searchId: string): Promise<LiveAttackResult> {
    if (!this.#config.liveAgent.isEnabled || !this.#config.provider) {
      throw new LiveAttackServiceError("LIVE_DISABLED", "Live Meta attacks are unavailable.");
    }
    const policy = parsePolicy(inputPolicy);
    const policyHash = canonicalHash(policy);
    const existing = this.#database
      .prepare("SELECT policy_hash, status, result_json FROM agent_searches WHERE id = ?")
      .get(searchId) as SearchRow | undefined;
    if (existing) {
      if (existing.policy_hash !== policyHash) {
        throw new LiveAttackServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "Attack intent was already used with another policy.",
        );
      }
      if (existing.result_json) {
        return {
          ...(JSON.parse(existing.result_json) as LiveAttackResult),
          replayed: true,
        };
      }
      throw new LiveAttackServiceError(
        existing.status === "claimed" ? "ATTACK_ALREADY_RUNNING" : "ATTACK_ALREADY_ATTEMPTED",
        existing.status === "claimed"
          ? "This attack is already running."
          : "This attack was interrupted and will not be sent again.",
      );
    }
    if (this.#inFlight) {
      throw new LiveAttackServiceError("PROVIDER_BUSY", "Another live attack is already running.");
    }

    const now = new Date().toISOString();
    this.#database
      .prepare(`
        INSERT INTO agent_searches
          (id, run_id, model_id, provenance, prompt_version, limits_json, policy_hash,
           policy_json, status, result_json, created_at, updated_at)
        VALUES (?, NULL, ?, 'live_model', 'attacker-v1', ?, ?, ?, 'claimed', NULL, ?, ?)
      `)
      .run(
        searchId,
        this.#config.provider.modelId,
        JSON.stringify(ATTACKER_LIMITS),
        policyHash,
        JSON.stringify(policy),
        now,
        now,
      );

    this.#inFlight = true;
    const provider = this.#createProvider(searchId);
    try {
      let verification: AttackerSearchResult;
      const initialState = createBottleReturnState();
      const session = new BoundedAttackerSession(initialState, policy);
      try {
        verification = await runBoundedAttacker(
          session,
          provider,
        );
      } catch {
        verification = {
          ...emptyVerification("run_incomplete"),
          requestsUsed: provider.turns.length,
          interruptionReason: "provider_error",
        };
      }

      let runId: string | null = null;
      if (verification.actions.length > 0) {
        const created = this.#runs.create(
          { policy, actions: [...verification.actions] },
          `live-${createHash("sha256").update(searchId).digest("hex").slice(0, 40)}`,
          {
            provenance: "live_model",
            modelId: this.#config.provider.modelId,
            limits: ATTACKER_LIMITS,
            initialState,
          },
        );
        let run = created.run;
        while (run.status === "queued" || run.status === "running") {
          await yieldToEventLoop();
          run = this.#runs.get(run.id);
        }
        if (run.status === "completed") runId = run.id;
      }

      const result: LiveAttackResult = {
        searchId,
        runId,
        provenance: "live_model",
        modelId: this.#config.provider.modelId,
        replayed: false,
        verification,
        turns: publicTurns(provider.turns),
        usage: usage(provider.turns),
        report: searchReport(verification, session.audit),
      };
      const finishedAt = new Date().toISOString();
      this.#database.transaction(() => {
        const insertTurn = this.#database.prepare(`
          INSERT INTO agent_turns
            (search_id, sequence, strategy_summary, tool_calls_json, usage_json)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const turn of provider.turns) {
          insertTurn.run(
            searchId,
            turn.sequence,
            turn.strategySummary,
            JSON.stringify(turn.toolCalls),
            JSON.stringify(turn.usage),
          );
        }
        this.#database
          .prepare(`
            UPDATE agent_searches
            SET run_id = ?, status = ?, result_json = ?, updated_at = ?
            WHERE id = ? AND status = 'claimed'
          `)
          .run(
            runId,
            verification.status === "run_incomplete" ? "incomplete" : "completed",
            JSON.stringify(result),
            finishedAt,
            searchId,
          );
      })();
      return result;
    } finally {
      this.#inFlight = false;
    }
  }
}
