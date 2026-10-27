import { describe, expect, it } from "vitest";

import {
  ATTACKER_LIMITS,
  BoundedAttackerSession,
  attackerToolDefinitions,
  runBoundedAttacker,
  type AttackerProvider,
} from "../../apps/server/src/runs/agent.js";
import { canonicalHash, ENGINE_VERSION } from "../../packages/engine/src/index.js";
import { createBottleReturnState } from "../../packages/engine/src/scenario.js";
import { replayActions } from "../../packages/evaluation/src/index.js";
import type { Policy } from "../../packages/policy/src/index.js";

const policy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "deposit-payout",
      enabled: true,
      trigger: "deposit",
      points: 10,
      eligibleOnly: false,
      materials: ["plastic", "aluminium", "carton", "rubbish"],
      repetition: "every_event",
    },
  ],
};

const exploitActions = [
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
] as const;

function call(id: string, name: string, args: unknown = {}) {
  return { id, name, arguments: args };
}

describe("bounded attacker host", () => {
  it("exposes only the five bounded tools and rejects unknown, duplicate, late, and over-limit calls", () => {
    expect(attackerToolDefinitions.map((tool) => tool.function.name)).toEqual([
      "inspect",
      "act",
      "reset_trial",
      "submit_candidate",
      "conclude_no_exploit",
    ]);

    const session = new BoundedAttackerSession(createBottleReturnState(), policy);
    expect(session.execute(call("unknown", "shell", {}))).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_TOOL" },
    });
    expect(session.execute(call("duplicate", "inspect"))).toMatchObject({ ok: true });
    expect(session.execute(call("duplicate", "inspect"))).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_CALL_ID" },
    });
    expect(
      session.execute(
        call("large-batch", "act", {
          actions: Array.from({ length: ATTACKER_LIMITS.maxActionsPerBatch + 1 }, () => ({
            type: "wait",
          })),
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_TOOL_ARGUMENTS" } });

    for (let index = 1; index < ATTACKER_LIMITS.maxTrials; index += 1) {
      expect(session.execute(call(`reset-${index}`, "reset_trial"))).toMatchObject({ ok: true });
    }
    expect(session.execute(call("reset-over-limit", "reset_trial"))).toMatchObject({
      ok: false,
      error: { code: "TRIAL_LIMIT_EXCEEDED" },
    });

    expect(
      session.execute(
        call("conclude", "conclude_no_exploit", { summary: "No exploit found in this search." }),
      ),
    ).toMatchObject({ ok: true });
    expect(session.execute(call("late", "inspect"))).toMatchObject({
      ok: false,
      error: { code: "SEARCH_ENDED" },
    });
  });

  it("cannot turn narrative-only output into verified evidence", async () => {
    const provider: AttackerProvider = {
      next: async () => ({
        strategySummary: "I found an exploit, trust me.",
        toolCalls: [],
      }),
    };
    const result = await runBoundedAttacker(
      new BoundedAttackerSession(createBottleReturnState(), policy),
      provider,
      { maxInferenceRequests: 2 },
    );

    expect(result).toMatchObject({
      status: "no_exploit_found_within_budget",
      verifiedActionCount: 0,
      evidenceEventIds: [],
      requestsUsed: 2,
    });
  });

  it("derives the verdict and evidence from an immutable-root replay", async () => {
    const turns = [
      { strategySummary: "Inspect the depot.", toolCalls: [call("inspect", "inspect")] },
      {
        strategySummary: "Submit a repeated-deposit trace.",
        toolCalls: [
          call("submit", "submit_candidate", {
            actions: exploitActions,
            summary: "Narrative falsely says 999 points and ten recycled items.",
            evidenceEventIds: [999],
          }),
        ],
      },
    ];
    const provider: AttackerProvider = {
      next: async () => turns.shift() ?? { strategySummary: "done", toolCalls: [] },
    };

    const initialState = createBottleReturnState();
    const result = await runBoundedAttacker(
      new BoundedAttackerSession(initialState, policy),
      provider,
    );
    const independentReplay = replayActions(initialState, exploitActions, policy);

    expect(result).toMatchObject({
      status: "exploit_verified",
      actions: exploitActions,
      verifiedActionCount: exploitActions.length,
      invalidActionCount: 0,
      totalReward: 30,
      usefulItems: 0,
      excessReward: 30,
      evidenceEventIds: [7, 9, 11],
      requestsUsed: 2,
    });
    expect(result.stateHash).toBe(
      canonicalHash({ engineVersion: ENGINE_VERSION, state: independentReplay.state }),
    );
  });

  it("does not verify a valid submitted trace with zero excess reward", () => {
    const session = new BoundedAttackerSession(createBottleReturnState(), policy);
    const result = session.execute(
      call("submit-honest", "submit_candidate", {
        actions: [{ type: "finish" }],
        summary: "No payout observed.",
        evidenceEventIds: [],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        status: "no_exploit_in_submitted_trace",
        actions: [{ type: "finish" }],
        totalReward: 0,
        excessReward: 0,
        evidenceEventIds: [],
      },
    });
  });

  it("does not execute a provider response that arrives after cancellation", async () => {
    let release!: (value: Awaited<ReturnType<AttackerProvider["next"]>>) => void;
    const provider: AttackerProvider = {
      next: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const session = new BoundedAttackerSession(createBottleReturnState(), policy);
    const run = runBoundedAttacker(session, provider);
    session.cancel();
    release({
      strategySummary: "late",
      toolCalls: [call("late-act", "act", { actions: [{ type: "wait" }] })],
    });

    await expect(run).resolves.toMatchObject({
      status: "run_incomplete",
      verifiedActionCount: 0,
      requestsUsed: 1,
    });
    expect(session.observation().state.tick).toBe(0);
  });

  it("ends an unresponsive provider request at the host timeout", async () => {
    const provider: AttackerProvider = {
      next: () => new Promise(() => undefined),
    };

    await expect(
      runBoundedAttacker(new BoundedAttackerSession(createBottleReturnState(), policy), provider, {
        requestTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({ status: "run_incomplete", requestsUsed: 1 });
  });
});
