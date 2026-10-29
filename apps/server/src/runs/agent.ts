import * as z from "zod";

import { actionSchema, type Action } from "../../../../packages/engine/src/actions.js";
import { step } from "../../../../packages/engine/src/step.js";
import type { WorldState } from "../../../../packages/engine/src/types.js";
import { replayActions, type ReplayResult } from "../../../../packages/evaluation/src/replay.js";
import type { Policy } from "../../../../packages/policy/src/schema.js";
import {
  emptyVerification,
  verifyCandidate,
  type VerificationResult,
} from "./verifier.js";

export const ATTACKER_LIMITS = {
  maxInferenceRequests: 12,
  maxTicksPerTrial: 120,
  maxTrials: 4,
  searchDeadlineMs: 120_000,
  requestTimeoutMs: 30_000,
  maxActionsPerBatch: 16,
} as const;

const actionJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "move" }, direction: { enum: ["up", "down", "left", "right"] } },
      required: ["type", "direction"],
      additionalProperties: false,
    },
    ...["take", "retrieve", "process"].map((type) => ({
      type: "object",
      properties: { type: { const: type }, itemId: { type: "string", minLength: 1, maxLength: 64 } },
      required: ["type", "itemId"],
      additionalProperties: false,
    })),
    ...["deposit", "reject", "drop", "wait", "finish"].map((type) => ({
      type: "object",
      properties: { type: { const: type } },
      required: ["type"],
      additionalProperties: false,
    })),
  ],
} as const;

export const attackerToolDefinitions = [
  {
    type: "function",
    function: {
      name: "inspect",
      description: "Read the current public trial state and currently legal actions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "act",
      description: "Execute 1 to 16 actions serially in the current sandbox trial.",
      parameters: {
        type: "object",
        properties: {
          actions: { type: "array", minItems: 1, maxItems: 16, items: actionJsonSchema },
        },
        required: ["actions"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_trial",
      description: "Reset to the same immutable initial state and policy.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_candidate",
      description: "Submit an explicit action trace for independent host verification.",
      parameters: {
        type: "object",
        properties: {
          actions: { type: "array", minItems: 1, maxItems: 120, items: actionJsonSchema },
          summary: { type: "string", minLength: 1, maxLength: 1_000 },
          evidenceEventIds: {
            type: "array",
            maxItems: 120,
            uniqueItems: true,
            items: { type: "integer", minimum: 1 },
          },
        },
        required: ["actions", "summary", "evidenceEventIds"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "conclude_no_exploit",
      description: "End this bounded search without claiming the policy is safe.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", minLength: 1, maxLength: 1_000 } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
] as const;

const emptyArgumentsSchema = z.strictObject({});
const actArgumentsSchema = z.strictObject({
  actions: z.array(actionSchema).min(1).max(ATTACKER_LIMITS.maxActionsPerBatch),
});
const submitArgumentsSchema = z.strictObject({
  actions: z.array(actionSchema).min(1).max(ATTACKER_LIMITS.maxTicksPerTrial),
  summary: z.string().trim().min(1).max(1_000),
  evidenceEventIds: z.array(z.number().int().positive()).max(120).refine((ids) => new Set(ids).size === ids.length),
});
const concludeArgumentsSchema = z.strictObject({
  summary: z.string().trim().min(1).max(1_000),
});

export interface AttackerToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export type AttackerToolResult =
  | { readonly callId: string; readonly name: string; readonly ok: true; readonly output: unknown }
  | {
      readonly callId: string;
      readonly name: string;
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface AttackerObservation {
  readonly trial: number;
  readonly remainingTicks: number;
  readonly state: WorldState;
  readonly legalActions: readonly Action[];
  readonly recentEvents: ReplayResult["events"];
}

export interface AttackerTurn {
  readonly strategySummary: string;
  readonly toolCalls: readonly AttackerToolCall[];
}

export interface AttackerProviderInput {
  readonly requestNumber: number;
  readonly policy: Policy;
  readonly observation: AttackerObservation;
  readonly previousToolResults: readonly AttackerToolResult[];
  readonly limits: typeof ATTACKER_LIMITS;
}

export interface AttackerProvider {
  next(input: AttackerProviderInput, signal: AbortSignal): Promise<AttackerTurn>;
}

export interface AttackerSearchResult extends VerificationResult {
  readonly requestsUsed: number;
  readonly interruptionReason:
    | "cancelled"
    | "deadline_exceeded"
    | "request_timeout"
    | "provider_error"
    | "malformed_response"
    | null;
}

export interface AttackerExecutionAudit {
  readonly trialsCompleted: number;
  readonly actionsTested: number;
  readonly attemptedTraces: readonly {
    readonly request: number;
    readonly trial: number;
    readonly kind: "trial" | "candidate";
    readonly hypothesis: string;
    readonly actions: readonly Action[];
  }[];
}

interface AttackerRunOptions {
  readonly maxInferenceRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly searchDeadlineMs?: number;
}

function withRequests(
  result: VerificationResult,
  requestsUsed: number,
  interruptionReason: AttackerSearchResult["interruptionReason"] = null,
): AttackerSearchResult {
  return { ...result, requestsUsed, interruptionReason };
}

function possibleActions(state: WorldState): readonly Action[] {
  const itemActions = state.items.flatMap<Action>((item) => [
    { type: "take", itemId: item.id },
    { type: "retrieve", itemId: item.id },
    { type: "process", itemId: item.id },
  ]);
  const candidates: readonly Action[] = [
    { type: "move", direction: "up" },
    { type: "move", direction: "down" },
    { type: "move", direction: "left" },
    { type: "move", direction: "right" },
    ...itemActions,
    { type: "deposit" },
    { type: "reject" },
    { type: "drop" },
    { type: "wait" },
    { type: "finish" },
  ];
  return state.terminal
    ? []
    : candidates.filter((action) => step(state, action).events.every((event) => event.success));
}

export class BoundedAttackerSession {
  readonly #initialState: WorldState;
  readonly #policy: Policy;
  readonly #callIds = new Set<string>();
  #trial = 1;
  #trialActions: Action[] = [];
  #replay: ReplayResult;
  #final: VerificationResult | null = null;
  #cancelled = false;
  readonly #attemptedTraces: AttackerExecutionAudit["attemptedTraces"][number][] = [];
  readonly #cancelController = new AbortController();

  constructor(initialState: WorldState, policy: Policy) {
    this.#initialState = structuredClone(initialState);
    this.#policy = structuredClone(policy);
    this.#replay = replayActions(this.#initialState, [], this.#policy);
  }

  get policy(): Policy {
    return structuredClone(this.#policy);
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  get signal(): AbortSignal {
    return this.#cancelController.signal;
  }

  get final(): VerificationResult | null {
    return this.#final;
  }

  get audit(): AttackerExecutionAudit {
    const attemptedTraces = structuredClone(this.#attemptedTraces);
    return {
      trialsCompleted: this.#trial,
      actionsTested: attemptedTraces.reduce((total, trace) => total + trace.actions.length, 0),
      attemptedTraces,
    };
  }

  observation(): AttackerObservation {
    const state = structuredClone(this.#replay.state);
    return {
      trial: this.#trial,
      remainingTicks: ATTACKER_LIMITS.maxTicksPerTrial - this.#trialActions.length,
      state,
      legalActions: possibleActions(state),
      recentEvents: structuredClone(this.#replay.events.slice(-10)),
    };
  }

  cancel(): void {
    if (this.#final) return;
    this.#cancelled = true;
    this.#cancelController.abort();
    this.#final = emptyVerification("run_incomplete");
  }

  finishWithoutCandidate(): VerificationResult {
    this.#final ??= emptyVerification("no_exploit_found_within_budget");
    return this.#final;
  }

  fail(): VerificationResult {
    this.#final ??= emptyVerification("run_incomplete");
    return this.#final;
  }

  execute(
    call: AttackerToolCall,
    context?: { readonly request: number; readonly hypothesis: string },
  ): AttackerToolResult {
    if (this.#final || this.#cancelled) return this.#error(call, "SEARCH_ENDED", "Search has ended.");
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(call.id)) {
      return this.#error(call, "INVALID_CALL_ID", "Tool call ID is invalid.");
    }
    if (this.#callIds.has(call.id)) {
      return this.#error(call, "DUPLICATE_CALL_ID", "Tool call ID was already used.");
    }
    this.#callIds.add(call.id);

    if (call.name === "inspect") {
      if (!emptyArgumentsSchema.safeParse(call.arguments).success) return this.#invalidArguments(call);
      return this.#success(call, this.observation());
    }
    if (call.name === "act") {
      const trial = this.#trial;
      const result = this.#act(call);
      this.#recordAttempt(call, result, context, trial);
      return result;
    }
    if (call.name === "reset_trial") return this.#reset(call);
    if (call.name === "submit_candidate") {
      const trial = this.#trial;
      const result = this.#submit(call);
      this.#recordAttempt(call, result, context, trial);
      return result;
    }
    if (call.name === "conclude_no_exploit") return this.#conclude(call);
    return this.#error(call, "UNKNOWN_TOOL", "Tool name is not available.");
  }

  #act(call: AttackerToolCall): AttackerToolResult {
    const parsed = actArgumentsSchema.safeParse(call.arguments);
    if (!parsed.success) return this.#invalidArguments(call);
    if (this.#replay.state.terminal) {
      return this.#error(call, "TRIAL_ENDED", "Current trial is terminal.");
    }
    if (this.#trialActions.length + parsed.data.actions.length > ATTACKER_LIMITS.maxTicksPerTrial) {
      return this.#error(call, "TICK_LIMIT_EXCEEDED", "Action batch exceeds the trial tick limit.");
    }

    const firstEventIndex = this.#replay.events.length;
    const firstPayoutIndex = this.#replay.payouts.length;
    let executedActionCount = 0;
    for (const action of parsed.data.actions) {
      if (this.#cancelled || this.#replay.state.terminal) break;
      const next = replayActions(this.#replay.state, [action], this.#policy);
      this.#trialActions.push(action);
      this.#replay = {
        state: next.state,
        events: [...this.#replay.events, ...next.events],
        payouts: [...this.#replay.payouts, ...next.payouts],
      };
      executedActionCount += 1;
    }
    return this.#success(call, {
      executedActionCount,
      state: this.#replay.state,
      events: this.#replay.events.slice(firstEventIndex),
      payouts: this.#replay.payouts.slice(firstPayoutIndex),
    });
  }

  #reset(call: AttackerToolCall): AttackerToolResult {
    if (!emptyArgumentsSchema.safeParse(call.arguments).success) return this.#invalidArguments(call);
    if (this.#trial >= ATTACKER_LIMITS.maxTrials) {
      return this.#error(call, "TRIAL_LIMIT_EXCEEDED", "Trial limit has been reached.");
    }
    this.#trial += 1;
    this.#trialActions = [];
    this.#replay = replayActions(this.#initialState, [], this.#policy);
    return this.#success(call, this.observation());
  }

  #submit(call: AttackerToolCall): AttackerToolResult {
    const parsed = submitArgumentsSchema.safeParse(call.arguments);
    if (!parsed.success) return this.#invalidArguments(call);
    this.#final = verifyCandidate(this.#initialState, this.#policy, parsed.data.actions);
    return this.#success(call, this.#final);
  }

  #conclude(call: AttackerToolCall): AttackerToolResult {
    if (!concludeArgumentsSchema.safeParse(call.arguments).success) return this.#invalidArguments(call);
    this.#final = emptyVerification("no_exploit_found_within_budget");
    return this.#success(call, this.#final);
  }

  #recordAttempt(
    call: AttackerToolCall,
    result: AttackerToolResult,
    context: { readonly request: number; readonly hypothesis: string } | undefined,
    trial: number,
  ): void {
    if (!context || !result.ok) return;
    const parsed = call.name === "act"
      ? actArgumentsSchema.safeParse(call.arguments)
      : submitArgumentsSchema.safeParse(call.arguments);
    if (!parsed.success) return;
    const count = Number(
      Reflect.get(
        result.output as object,
        call.name === "act" ? "executedActionCount" : "verifiedActionCount",
      ),
    );
    const actions = parsed.data.actions.slice(0, count);
    if (actions.length === 0) return;
    this.#attemptedTraces.push({
      request: context.request,
      trial,
      kind: call.name === "act" ? "trial" : "candidate",
      hypothesis: context.hypothesis,
      actions,
    });
  }

  #invalidArguments(call: AttackerToolCall): AttackerToolResult {
    return this.#error(call, "INVALID_TOOL_ARGUMENTS", "Tool arguments are invalid.");
  }

  #success(call: AttackerToolCall, output: unknown): AttackerToolResult {
    return { callId: call.id, name: call.name, ok: true, output };
  }

  #error(call: AttackerToolCall, code: string, message: string): AttackerToolResult {
    return { callId: call.id, name: call.name, ok: false, error: { code, message } };
  }
}

const attackerTurnSchema = z.strictObject({
  strategySummary: z.string().trim().min(1).max(1_000),
  toolCalls: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        arguments: z.unknown(),
      }),
    )
    .max(32),
});

export async function runBoundedAttacker(
  session: BoundedAttackerSession,
  provider: AttackerProvider,
  options: AttackerRunOptions = {},
): Promise<AttackerSearchResult> {
  const maxInferenceRequests = Math.min(
    options.maxInferenceRequests ?? ATTACKER_LIMITS.maxInferenceRequests,
    ATTACKER_LIMITS.maxInferenceRequests,
  );
  const requestTimeoutMs = Math.min(
    options.requestTimeoutMs ?? ATTACKER_LIMITS.requestTimeoutMs,
    ATTACKER_LIMITS.requestTimeoutMs,
  );
  const searchDeadlineMs = Math.min(
    options.searchDeadlineMs ?? ATTACKER_LIMITS.searchDeadlineMs,
    ATTACKER_LIMITS.searchDeadlineMs,
  );
  const startedAt = Date.now();
  let requestsUsed = 0;
  let previousToolResults: readonly AttackerToolResult[] = [];

  while (requestsUsed < maxInferenceRequests) {
    if (session.cancelled || session.final) {
      return withRequests(
        session.final ?? session.fail(),
        requestsUsed,
        session.cancelled ? "cancelled" : null,
      );
    }
    const remainingMs = searchDeadlineMs - (Date.now() - startedAt);
    if (remainingMs <= 0) return withRequests(session.fail(), requestsUsed, "deadline_exceeded");

    requestsUsed += 1;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let requestTimedOut = false;
    const timeout = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, Math.min(requestTimeoutMs, remainingMs));
    let abortRequest!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortRequest = () => reject(new Error("Attacker request aborted."));
      signal.addEventListener("abort", abortRequest, { once: true });
    });
    let rawTurn: AttackerTurn;
    try {
      rawTurn = await Promise.race([
        provider.next(
          {
            requestNumber: requestsUsed,
            policy: session.policy,
            observation: session.observation(),
            previousToolResults,
            limits: ATTACKER_LIMITS,
          },
          signal,
        ),
        aborted,
      ]);
    } catch {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortRequest);
      return withRequests(
        session.fail(),
        requestsUsed,
        session.cancelled ? "cancelled" : requestTimedOut ? "request_timeout" : "provider_error",
      );
    }
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortRequest);

    if (session.cancelled || Date.now() - startedAt >= searchDeadlineMs) {
      return withRequests(
        session.fail(),
        requestsUsed,
        session.cancelled ? "cancelled" : "deadline_exceeded",
      );
    }
    const parsedTurn = attackerTurnSchema.safeParse(rawTurn);
    if (!parsedTurn.success) {
      return withRequests(session.fail(), requestsUsed, "malformed_response");
    }
    previousToolResults = parsedTurn.data.toolCalls.map((call) =>
      session.execute(call, {
        request: requestsUsed,
        hypothesis: parsedTurn.data.strategySummary,
      }),
    );
    const final = session.final;
    if (final) return withRequests(final, requestsUsed);
  }

  return withRequests(session.finishWithoutCandidate(), requestsUsed);
}
