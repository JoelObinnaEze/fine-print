import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  type Action,
} from "../../packages/engine/src/index.js";
import {
  calculateCompletedMetrics,
  calculateTestedPolicyScore,
  createHonestWorkerActions,
  replayActions,
} from "../../packages/evaluation/src/index.js";
import type { Policy, PolicyClause } from "../../packages/policy/src/index.js";

const processClause: PolicyClause = {
  id: "eligible-process",
  enabled: true,
  trigger: "process",
  points: 10,
  eligibleOnly: true,
  materials: ["plastic", "aluminium"],
  repetition: "once_per_item",
};

const eligibleProcessPolicy: Policy = {
  schemaVersion: 1,
  clauses: [processClause],
};

function completedReplay(actions: readonly Action[], policy: Policy) {
  const initialState = createBottleReturnState();
  return {
    initialState,
    replay: replayActions(initialState, [...actions, { type: "finish" }], policy),
  };
}

describe("completed replay scoring", () => {
  it("scores repeated deposits as per-item excess reward", () => {
    const actions: readonly Action[] = [
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
    ];
    const depositPolicy: Policy = {
      schemaVersion: 1,
      clauses: [{ ...processClause, trigger: "deposit", eligibleOnly: false, repetition: "every_event" }],
    };
    const { initialState, replay } = completedReplay(actions, depositPolicy);

    expect(calculateCompletedMetrics(initialState, replay)).toMatchObject({
      reward: 30,
      usefulItems: 0,
      eligibleItems: 6,
      aggregateRewardGap: 30,
      excessReward: 30,
      leakage: 0.5,
    });
  });

  it("does not let underpayment hide reward on another item", () => {
    const actions: readonly Action[] = [
      { type: "move", direction: "up" },
      { type: "take", itemId: "B1" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "deposit" },
      { type: "move", direction: "left" },
      { type: "move", direction: "left" },
      { type: "move", direction: "left" },
      { type: "move", direction: "left" },
      { type: "take", itemId: "C1" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "deposit" },
      { type: "move", direction: "down" },
      { type: "move", direction: "down" },
      { type: "process", itemId: "C1" },
    ];
    const plasticDepositPolicy: Policy = {
      schemaVersion: 1,
      clauses: [
        {
          ...processClause,
          trigger: "deposit",
          materials: ["plastic"],
        },
      ],
    };
    const { initialState, replay } = completedReplay(actions, plasticDepositPolicy);
    const metrics = calculateCompletedMetrics(initialState, replay);

    expect(metrics.aggregateRewardGap).toBe(0);
    expect(metrics.excessReward).toBe(10);
  });

  it("measures zero, partial, and full honest-worker coverage", () => {
    const initialState = createBottleReturnState();
    const actions = createHonestWorkerActions(initialState);
    const policies: readonly Policy[] = [
      { schemaVersion: 1, clauses: [] },
      {
        schemaVersion: 1,
        clauses: [{ ...processClause, materials: ["plastic"] }],
      },
      eligibleProcessPolicy,
    ];

    const coverages = policies.map(
      (policy) =>
        calculateCompletedMetrics(
          initialState,
          replayActions(initialState, actions, policy),
        ).legitimateCoverage,
    );

    expect(coverages).toEqual([0, 0.5, 1]);
    expect(coverages.map((coverage) => calculateTestedPolicyScore(coverage, 0))).toEqual([
      0, 50, 100,
    ]);
  });

  it("rejects metrics for an episode that has not completed", () => {
    const initialState = createBottleReturnState();
    const replay = replayActions(initialState, [], eligibleProcessPolicy);

    expect(() => calculateCompletedMetrics(initialState, replay)).toThrow(
      "completed episode",
    );
  });
});
