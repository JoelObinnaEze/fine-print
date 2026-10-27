import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  type EngineEvent,
  type WorldState,
} from "../../packages/engine/src/index.js";
import {
  evaluatePayouts,
  parsePolicy,
  type Policy,
  type PolicyClause,
} from "../../packages/policy/src/index.js";

const startingClause: PolicyClause = {
  id: "reward-1",
  enabled: true,
  trigger: "deposit",
  points: 10,
  eligibleOnly: false,
  materials: ["plastic", "aluminium", "carton", "rubbish"],
  repetition: "every_event",
};

const startingPolicy: Policy = {
  schemaVersion: 1,
  clauses: [startingClause],
};

function depositEvent(sequence = 1): EngineEvent {
  return {
    sequence,
    tick: sequence,
    kind: "deposit",
    itemId: "B1",
    from: { kind: "inventory" },
    to: { kind: "hopper" },
    success: true,
    reason: null,
  };
}

function stateWithBottleInInventory(): WorldState {
  const state = createBottleReturnState();
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === "B1" ? { ...item, locus: { kind: "inventory" } } : item,
    ),
  };
}

describe("parsePolicy", () => {
  it("accepts the bounded starting policy", () => {
    expect(parsePolicy(startingPolicy)).toEqual(startingPolicy);
  });

  it.each([
    ["unknown policy fields", { ...startingPolicy, surprise: true }],
    [
      "unknown clause fields",
      {
        ...startingPolicy,
        clauses: [{ ...startingClause, condition: "anything" }],
      },
    ],
    [
      "duplicate clause IDs",
      {
        ...startingPolicy,
        clauses: [startingClause, startingClause],
      },
    ],
    [
      "duplicate materials",
      {
        ...startingPolicy,
        clauses: [
          { ...startingClause, materials: ["plastic", "plastic"] },
        ],
      },
    ],
    [
      "more than four clauses",
      {
        ...startingPolicy,
        clauses: Array.from({ length: 5 }, (_, index) => ({
          ...startingClause,
          id: `reward-${index}`,
        })),
      },
    ],
    [
      "noninteger points",
      {
        ...startingPolicy,
        clauses: [{ ...startingClause, points: 1.5 }],
      },
    ],
    [
      "out-of-range points",
      {
        ...startingPolicy,
        clauses: [{ ...startingClause, points: 11 }],
      },
    ],
    [
      "unsupported triggers",
      {
        ...startingPolicy,
        clauses: [{ ...startingClause, trigger: "retrieve" }],
      },
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(() => parsePolicy(candidate)).toThrow();
  });
});

describe("evaluatePayouts", () => {
  it("pays every matching clause in stable policy order", () => {
    const policy: Policy = {
      ...startingPolicy,
      clauses: [
        startingClause,
        { ...startingClause, id: "bonus", points: 3 },
      ],
    };

    const result = evaluatePayouts(
      stateWithBottleInInventory(),
      depositEvent(),
      policy,
    );

    expect(result.payouts.map(({ clauseId, amount }) => ({ clauseId, amount }))).toEqual([
      { clauseId: "reward-1", amount: 10 },
      { clauseId: "bonus", amount: 3 },
    ]);
    expect(result.rewardLedger).toEqual({
      totalPoints: 13,
      rewardedItemIdsByClause: { "reward-1": ["B1"], bonus: ["B1"] },
    });
    expect(result.payouts[0]?.predicateResults).toEqual({
      enabled: true,
      trigger: true,
      eligible: true,
      material: true,
      repetition: true,
    });
  });

  it("tracks once-per-item history per clause", () => {
    const policy: Policy = {
      ...startingPolicy,
      clauses: [
        { ...startingClause, repetition: "once_per_item" },
      ],
    };
    const state = stateWithBottleInInventory();
    const first = evaluatePayouts(state, depositEvent(1), policy);
    const second = evaluatePayouts(
      { ...state, rewardLedger: first.rewardLedger },
      depositEvent(2),
      policy,
    );

    expect(first.payouts).toHaveLength(1);
    expect(second.payouts).toEqual([]);
    expect(second.rewardLedger).toEqual(first.rewardLedger);
  });

  it("does not pay failed, disabled, ineligible, or material-mismatched events", () => {
    const state = stateWithBottleInInventory();
    const failed = { ...depositEvent(), success: false, reason: "rejected" };
    const gated: Policy = {
      ...startingPolicy,
      clauses: [
        { ...startingClause, id: "disabled", enabled: false },
        {
          ...startingClause,
          id: "ineligible",
          eligibleOnly: true,
          materials: ["carton"],
        },
      ],
    };

    expect(evaluatePayouts(state, failed, startingPolicy).payouts).toEqual([]);
    expect(evaluatePayouts(state, depositEvent(), gated).payouts).toEqual([]);
  });
});
