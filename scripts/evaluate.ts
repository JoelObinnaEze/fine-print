import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyRunExport, type RunExport } from "../apps/server/src/runs/export.js";
import {
  canonicalHash,
  createBottleReturnState,
  ENGINE_VERSION,
  type Action,
} from "../packages/engine/src/index.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { runSimpleActionSearch } from "../apps/server/src/runs/baseline.js";
import type { LiveAttackResult } from "../apps/server/src/runs/live-attack-service.js";
import {
  calculateCompletedMetrics,
  calculateTestedPolicyScore,
  createHonestWorkerActions,
  hashReplay,
  replayActions,
} from "../packages/evaluation/src/index.js";
import type { Policy, PolicyClause } from "../packages/policy/src/index.js";
import {
  runCommerceActionSearch,
  type CommercePolicy,
} from "../packages/commerce/src/index.js";
import type { PolicyInterpretation } from "../packages/policy/src/interpret.js";
import { discoveryBaseline, discoverySuite } from "./discovery-suite.js";
import {
  evaluateFrozenCase,
  frozenEvaluationSuite,
  frozenSuiteHash,
  interpretationSuite,
} from "./frozen-evaluation-suite.js";

const initialState = createBottleReturnState();
const depositClause: PolicyClause = {
  id: "deposit-payout",
  enabled: true,
  trigger: "deposit" as const,
  points: 10,
  eligibleOnly: false,
  materials: ["plastic", "aluminium", "carton", "rubbish"],
  repetition: "every_event",
};
const policies: Readonly<Record<string, Policy>> = {
  noRewards: { schemaVersion: 1, clauses: [] },
  everyDeposit: { schemaVersion: 1, clauses: [depositClause] },
  oncePerItemDeposit: {
    schemaVersion: 1,
    clauses: [{ ...depositClause, repetition: "once_per_item" }],
  },
  eligibleProcessing: {
    schemaVersion: 1,
    clauses: [
      {
        ...depositClause,
        id: "eligible-processing",
        trigger: "process",
        eligibleOnly: true,
        materials: ["plastic", "aluminium"],
        repetition: "once_per_item",
      },
    ],
  },
};

const repeatedDeposit: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "B1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
  { type: "finish" },
];
const contamination: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "R1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "move", direction: "down" },
  { type: "move", direction: "right" },
  { type: "process", itemId: "R1" },
  { type: "finish" },
];
const traces = { repeatedDeposit, contamination } as const;
const honestOrders = [
  ["B1", "B2", "B3", "C1", "C2", "C3"],
  ["C3", "C2", "C1", "B3", "B2", "B1"],
  ["B1", "C1", "B2", "C2", "B3", "C3"],
] as const;

function metricsFor(actions: readonly Action[], policy: Policy) {
  const replay = replayActions(initialState, actions, policy);
  const replayHash = hashReplay(replay);
  return {
    actions: actions.length,
    ...calculateCompletedMetrics(initialState, replay),
    replayHash,
    deterministicReplayAgreement:
      replayHash === hashReplay(replayActions(initialState, actions, policy)),
  };
}

const policyResults = Object.entries(policies).map(([id, policy]) => {
  const honest = honestOrders.map((order) =>
    metricsFor(createHonestWorkerActions(initialState, order), policy),
  );
  const adversarial = Object.fromEntries(
    Object.entries(traces).map(([traceId, actions]) => [traceId, metricsFor(actions, policy)]),
  );
  const minimumCoverage = Math.min(...honest.map((result) => result.legitimateCoverage));
  const maximumLeakage = Math.max(
    ...Object.values(adversarial).map((result) => result.leakage),
  );
  return {
    id,
    honestCoverage: {
      passingItems: minimumCoverage * 6,
      eligibleItems: 6,
      minimumCoverage,
      ordersTested: honest.length,
    },
    maximumObservedLeakage: maximumLeakage,
    adversarialTracesTested: Object.keys(adversarial).length,
    testedPolicyScore: calculateTestedPolicyScore(minimumCoverage, maximumLeakage),
    honest,
    adversarial,
  };
});

const livePath = resolve("artifacts/attacker-live-v2.json");
let liveEvidence: unknown = { status: "not_run", reason: "Live export artifact is absent." };
if (existsSync(livePath)) {
  const exported = JSON.parse(readFileSync(livePath, "utf8")) as RunExport;
  const replay = verifyRunExport(exported);
  liveEvidence = {
    status: "completed",
    provenance: exported.provenance,
    modelId: exported.modelId,
    limits: exported.limits,
    usage: exported.usage,
    verifiedActionCount: exported.actions.length,
    ...calculateCompletedMetrics(initialState, {
      ...replay,
      state: replay.state.terminal
        ? replay.state
        : replayActions(replay.state, [{ type: "finish" }], exported.policy).state,
    }),
    replayHash: exported.replayHash,
  };
}

interface SearchResultRow {
  readonly id: string;
  readonly status: string;
  readonly result_json: string;
}

const databasePath = resolve("fine-print.db");
const persistedSearches = new Map<string, readonly SearchResultRow[]>();
if (existsSync(databasePath)) {
  const database = openDatabase(databasePath);
  try {
    for (const benchmark of discoverySuite) {
      const policyHash = canonicalHash(benchmark.policy);
      persistedSearches.set(
        benchmark.id,
        database
          .prepare(`
            SELECT id, status, result_json
            FROM agent_searches
            WHERE policy_hash = ? AND result_json IS NOT NULL
            ORDER BY created_at, id
          `)
          .all(policyHash) as SearchResultRow[],
      );
    }
  } finally {
    database.close();
  }
}

const discoveryBenchmark = {
  status: "completed",
  frozenSuiteHash: canonicalHash(
    discoverySuite.map(({ id, expected, policy, expectedHonestReward }) => ({
      id,
      expected,
      policy,
      expectedHonestReward,
    })),
  ),
  baselineLimits: discoveryBaseline,
  museLimits: {
    maxInferenceRequests: 12,
    maxTrials: 4,
    maxTicksPerTrial: 120,
    searchDeadlineMs: 120_000,
  },
  policies: discoverySuite.map((benchmark) => {
    const baselineAttempts = discoveryBaseline.seeds.map((seed) => {
      const result = runSimpleActionSearch(initialState, benchmark.policy, {
        seed,
        maxExpandedStates: discoveryBaseline.maxExpandedStates,
        maxActions: discoveryBaseline.maxActions,
        beamWidth: discoveryBaseline.beamWidth,
      });
      return {
        seed,
        status: result.status,
        expandedStates: result.expandedStates,
        actionsToFirstExploit: result.actionsToFirstExploit,
        verifiedExcessReward: result.verification.excessReward,
        rejectedClaims: result.rejectedClaims,
      };
    });
    const museAttempts = (persistedSearches.get(benchmark.id) ?? []).map((row) => {
      const result = JSON.parse(row.result_json) as LiveAttackResult;
      return {
        searchId: row.id,
        runId: result.runId,
        persistedStatus: row.status,
        outcome: result.report.outcome,
        reason: result.report.reason,
        requestsUsed: result.report.requestsUsed,
        trialsCompleted: result.report.trialsCompleted,
        actionsTested: result.report.actionsTested,
        verificationStatus: result.verification.status,
        totalReward: result.verification.totalReward,
        usefulItems: result.verification.usefulItems,
        verifiedExcessReward: result.verification.excessReward,
        actualUsd: result.usage.actualUsd,
      };
    });
    const honestReplay = replayActions(initialState, benchmark.honestActions, benchmark.policy);
    return {
      id: benchmark.id,
      expected: benchmark.expected,
      policyHash: canonicalHash(benchmark.policy),
      honestReward: {
        expected: benchmark.expectedHonestReward,
        actual: honestReplay.state.rewardLedger.totalPoints,
        usefulItems: honestReplay.state.outcomeLedger.processedEligibleItemIds.length,
        preserved: honestReplay.state.rewardLedger.totalPoints === benchmark.expectedHonestReward,
      },
      simpleActionSearch: {
        verifiedExploitsFound: baselineAttempts.filter(({ status }) => status === "exploit_verified").length,
        repeatedRuns: baselineAttempts.length,
        rejectedClaims: baselineAttempts.reduce((total, attempt) => total + attempt.rejectedClaims, 0),
        attempts: baselineAttempts,
      },
      muse: {
        status: museAttempts.length > 0 ? "completed" : "not_run",
        verifiedExploitsFound: museAttempts.filter(({ outcome }) => outcome === "verified_exploit").length,
        repeatedRuns: museAttempts.length,
        rejectedClaims: museAttempts.filter(({ outcome }) => outcome === "candidate_rejected").length,
        attempts: museAttempts,
      },
    };
  }),
};

const frozenAttempts = new Map<string, readonly unknown[]>();
const interpretationAttempts = new Map<string, unknown>();
let supersededCommerceAttempts: readonly unknown[] = [];
if (existsSync(databasePath)) {
  const database = openDatabase(databasePath);
  try {
    const bottleRows = database
      .prepare("SELECT policy_hash, result_json FROM agent_searches WHERE result_json IS NOT NULL ORDER BY created_at, id")
      .all() as { readonly policy_hash: string | null; readonly result_json: string }[];
    const commerceRows = database
      .prepare("SELECT id, idempotency_key, state, result_json, error_code, error_message FROM commerce_investigations ORDER BY created_at, id")
      .all() as {
        readonly id: string;
        readonly idempotency_key: string;
        readonly state: string;
        readonly result_json: string | null;
        readonly error_code: string | null;
        readonly error_message: string | null;
      }[];
    const translationRows = database
      .prepare("SELECT idempotency_key, state, result_json FROM policy_translations WHERE idempotency_key LIKE 'interpretation-v1-%' ORDER BY created_at, id")
      .all() as {
        readonly idempotency_key: string;
        readonly state: string;
        readonly result_json: string | null;
      }[];
    for (const item of interpretationSuite) {
      const idempotencyKey = `interpretation-v1-${item.id}`;
      if (item.id.startsWith("commerce-")) {
        const row = commerceRows.find((candidate) => candidate.idempotency_key === idempotencyKey);
        if (!row) continue;
        if (!row.result_json) {
          interpretationAttempts.set(item.id, {
            outcome: "interrupted",
            reason: row.error_message ?? row.error_code ?? row.state,
          });
          continue;
        }
        const result = JSON.parse(row.result_json) as {
          readonly mapping: { readonly status: string; readonly reason: string; readonly policy: CommercePolicy | null };
          readonly usage: { readonly actualUsd: number };
        };
        interpretationAttempts.set(item.id, {
          outcome: result.mapping.status,
          reason: result.mapping.reason,
          actualFields: result.mapping.policy?.referral ?? {},
          actualUsd: result.usage.actualUsd,
        });
        continue;
      }
      const row = translationRows.find((candidate) => candidate.idempotency_key === idempotencyKey);
      if (!row) continue;
      if (!row.result_json) {
        interpretationAttempts.set(item.id, { outcome: "interrupted", reason: row.state });
        continue;
      }
      const result = JSON.parse(row.result_json) as {
        readonly interpretation: PolicyInterpretation;
        readonly usage: { readonly actualUsd: number };
      };
      interpretationAttempts.set(item.id, {
        outcome: result.interpretation.status,
        reason: result.interpretation.reason,
        actualFields:
          result.interpretation.status === "candidate"
            ? result.interpretation.policy.clauses[0] ?? {}
            : {},
        actualUsd: result.usage.actualUsd,
      });
    }
    supersededCommerceAttempts = commerceRows
      .filter((row) =>
        row.idempotency_key.startsWith("frozen-v2-commerce-") ||
        row.idempotency_key.startsWith("frozen-v3-commerce-"),
      )
      .map((row) => {
        const result = row.result_json ? JSON.parse(row.result_json) as {
          readonly id: string;
          readonly attemptOutcome?: string;
          readonly mapping?: { readonly status?: string };
          readonly usage?: { readonly actualUsd?: number };
        } : null;
        return {
          idempotencyKey: row.idempotency_key,
          runId: result?.id ?? row.id,
          outcome: result?.attemptOutcome ?? result?.mapping?.status ?? row.error_code ?? row.state,
          actualUsd: result?.usage?.actualUsd ?? null,
          excludedReason: row.idempotency_key.startsWith("frozen-v2-")
            ? "Superseded benchmark wording did not preserve the frozen executable mapping."
            : "Superseded by v4 after the return-window boundary and validated initial-state fixes.",
        };
      });
    for (const item of frozenEvaluationSuite.cases) {
      const policyHash = canonicalHash(item.policy);
      if (item.domain === "bottle_return") {
        frozenAttempts.set(
          item.id,
          bottleRows
            .filter((row) => row.policy_hash === policyHash)
            .map((row) => {
              const result = JSON.parse(row.result_json) as Partial<LiveAttackResult> & {
                readonly verification?: {
                  readonly status?: string;
                  readonly verifiedActionCount?: number;
                  readonly invalidActionCount?: number;
                  readonly requestsUsed?: number;
                };
                readonly usage?: LiveAttackResult["usage"] & { readonly requests?: number };
              };
              if (!result.report && result.verification && result.usage) {
                return {
                  provenance: "model_found",
                  runId: result.runId ?? null,
                  outcome:
                    result.verification.status === "exploit_verified"
                      ? "verified_exploit"
                      : "search_completed",
                  reason:
                    result.verification.status === "exploit_verified"
                      ? "Host replay verified the submitted trace."
                      : "No failure was verified within this attempt's budget.",
                  requestsUsed:
                    result.usage.requests ?? result.verification.requestsUsed ?? null,
                  actionsTested:
                    (result.verification.verifiedActionCount ?? 0) +
                    (result.verification.invalidActionCount ?? 0),
                  actualUsd: result.usage.actualUsd,
                };
              }
              if (!result.report || !result.usage) {
                return {
                  provenance: "model_found",
                  runId: result.runId ?? null,
                  outcome: "persisted_result_unreadable",
                  reason: "The persisted attempt did not match a supported result schema.",
                  requestsUsed: null,
                  actionsTested: null,
                  actualUsd: null,
                };
              }
              return {
                provenance: "model_found",
                runId: result.runId,
                outcome: result.report.outcome,
                reason: result.report.reason,
                requestsUsed: result.report.requestsUsed,
                actionsTested: result.report.actionsTested,
                actualUsd: result.usage.actualUsd,
              };
            }),
        );
      } else {
        frozenAttempts.set(
          item.id,
          commerceRows
            .filter((row) => row.idempotency_key.startsWith(`frozen-v4-${item.id}-`))
            .map((row) => {
              if (!row.result_json) {
                return {
                  provenance: "model_found",
                  runId: row.id,
                  mappingMatchesFrozenPolicy: null,
                  outcome: row.error_code ?? "interrupted",
                  reason: row.error_message ?? "The live attempt did not produce a completed result.",
                  requestsUsed: 1,
                  actionsTested: 0,
                  actualUsd: null,
                };
              }
              const result = JSON.parse(row.result_json) as {
                readonly id: string;
                readonly attemptOutcome?: string;
                readonly mapping?: { readonly policy?: { readonly referral: CommercePolicy["referral"] } | null };
                readonly attack?: { readonly proposedActionCount: number; readonly verification: { readonly status: string; readonly reason: string } } | null;
                readonly usage: { readonly actualUsd: number };
              };
              return {
                provenance: "model_found",
                runId: result.id,
                mappingMatchesFrozenPolicy:
                  result.mapping?.policy !== null &&
                  result.mapping?.policy !== undefined &&
                  canonicalHash(result.mapping.policy.referral) ===
                    canonicalHash(item.policy.referral),
                outcome: result.attemptOutcome ?? result.attack?.verification.status ?? "unknown",
                reason: result.attack?.verification.reason ?? "No executable mapping was produced.",
                requestsUsed: 1,
                actionsTested: result.attack?.proposedActionCount ?? 0,
                actualUsd: result.usage.actualUsd,
              };
            }),
        );
      }
    }
  } finally {
    database.close();
  }
}

const interpretationResults = interpretationSuite.map((item) => {
  const attempt = interpretationAttempts.get(item.id) as {
    readonly outcome?: string;
    readonly reason?: string;
    readonly actualFields?: Readonly<Record<string, unknown>>;
    readonly actualUsd?: number;
  } | undefined;
  const expectedOutcome = item.expectedDisposition === "map" ? "candidate" :
    item.expectedDisposition === "clarify" ? "ambiguous" : "unsupported";
  const fieldsMatch = attempt !== undefined && Object.entries(item.expectedFields).every(
    ([key, value]) => JSON.stringify(attempt.actualFields?.[key]) === JSON.stringify(value),
  );
  return {
    ...item,
    attempt: attempt ?? null,
    dispositionMatches: attempt?.outcome === expectedOutcome,
    expectedFieldsMatch: fieldsMatch,
    passed: attempt?.outcome === expectedOutcome && fieldsMatch,
  };
});

const frozenBenchmark = {
  status: "offline_complete_live_incomplete",
  designedBenchmark: true,
  suiteVersion: frozenEvaluationSuite.version,
  suiteHash: frozenSuiteHash,
  attemptsRequestedPerCase: 3,
  supersededCommerceAttempts,
  interpretation: {
    status:
      interpretationAttempts.size === interpretationSuite.length
        ? "completed"
        : interpretationAttempts.size > 0
          ? "partial"
          : "not_run",
    attemptsPerCase: interpretationAttempts.size > 0 ? 1 : 0,
    cases: interpretationResults,
    note: "Interpretation is run and scored separately from transaction discovery; only persisted live provider results count.",
  },
  cases: frozenEvaluationSuite.cases.map((item) => {
    const reference = evaluateFrozenCase(item);
    const attempts = frozenAttempts.get(item.id) ?? [];
    const interpretationMismatches = attempts.filter(
      (attempt) =>
        typeof attempt === "object" &&
        attempt !== null &&
        Reflect.get(attempt, "mappingMatchesFrozenPolicy") === false,
    ).length;
    const discoveryAttemptsScored =
      item.domain === "bottle_return"
        ? attempts.length
        : attempts.filter(
            (attempt) =>
              typeof attempt === "object" &&
              attempt !== null &&
              Reflect.get(attempt, "mappingMatchesFrozenPolicy") === true,
          ).length;
    const baselineAttempts =
      item.domain === "bottle_return"
        ? discoveryBaseline.seeds.map((seed) => {
            const result = runSimpleActionSearch(item.initialState, item.policy, {
              seed,
              maxExpandedStates: discoveryBaseline.maxExpandedStates,
              maxActions: discoveryBaseline.maxActions,
              beamWidth: discoveryBaseline.beamWidth,
            });
            return {
              provenance: "baseline_found",
              seed,
              outcome: result.status,
              expandedStates: result.expandedStates,
              actionsToFirstFailure: result.actionsToFirstExploit,
              rejectedClaims: result.rejectedClaims,
            };
          })
        : [(() => {
            const result = runCommerceActionSearch(
              item.initialState,
              item.policy,
              item.goal,
              { maxActions: 5, maxExpandedStates: 5_000 },
            );
            return {
              provenance: "baseline_found",
              outcome: result.status,
              expandedStates: result.expandedStates,
              actionsToFirstFailure: result.actions.length || null,
              rejectedClaims: 0,
            };
          })()];
    return {
      id: item.id,
      domain: item.domain,
      mechanism: item.mechanism,
      expected: item.expected,
      intendedOutcome: item.intendedOutcome,
      protectedLegitimateBehavior: item.protectedLegitimateBehavior,
      initialState: item.initialState,
      initialStateHash: canonicalHash(item.initialState),
      policy: item.policy,
      policyHash: canonicalHash(item.policy),
      referenceActions: item.referenceActions,
      referenceResult: reference,
      simpleActionSearch: {
        status: "completed",
        limits: item.domain === "bottle_return"
          ? discoveryBaseline
          : { maxActions: 5, maxExpandedStates: 5_000, deterministic: true },
        attempts: baselineAttempts,
      },
      muse: {
        status: attempts.length >= 3 ? "completed" : attempts.length > 0 ? "partial" : "not_run",
        limits: item.domain === "bottle_return"
          ? { maxInferenceRequests: 12, maxTrials: 4, maxTicksPerTrial: 120, searchDeadlineMs: 120_000 }
          : { maxInferenceRequests: 1, maxCandidateActions: 40, requestTimeoutMs: 60_000 },
        attempts,
        interpretationMismatches,
        discoveryAttemptsScored,
      },
    };
  }),
  acceptanceCases: [
    { id: "supported-policy-maps", status: "automated", evidence: "tests/provider/meta-commerce.test.ts" },
    { id: "genuine-failure-verifies", status: "automated", evidence: "tests/evaluation/frozen-suite.test.ts" },
    { id: "trace-minimizes", status: "automated", evidence: "tests/commerce/benchmark.test.ts" },
    { id: "plausible-repair-fails-another-case", status: "automated", evidence: "tests/commerce/benchmark.test.ts" },
    { id: "stronger-repair-preserves-honest-reward", status: "automated", evidence: "tests/commerce/benchmark.test.ts" },
    { id: "recommendation-updates", status: "automated", evidence: "tests/web/commerce-workbench.test.tsx" },
    { id: "unsupported-condition-disclosed", status: "automated", evidence: "tests/provider/meta-commerce.test.ts" },
    { id: "unsuccessful-search-is-not-a-safety-claim", status: "automated", evidence: "tests/web/commerce-workbench.test.tsx" },
  ],
};

const report = {
  schemaVersion: 1,
  status: "completed",
  engineVersion: ENGINE_VERSION,
  scenario: { seed: initialState.seed, eligibleItems: 6, totalItems: 8 },
  offlineUsage: { inferenceRequests: 0, providerCostUsd: 0 },
  policyResults,
  liveEvidence,
  discoveryBenchmark,
  frozenBenchmark,
  usabilityStudy: { status: "not_run", participants: 0 },
};

const outputPath = resolve("artifacts/evaluation.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(outputPath);
