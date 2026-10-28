import { describe, expect, it } from "vitest";

import type { Action } from "../../packages/engine/src/actions.js";
import { createBottleReturnState } from "../../packages/engine/src/scenario.js";
import { replayActions } from "../../packages/evaluation/src/replay.js";
import type { Policy } from "../../packages/policy/src/schema.js";

const processReward: Policy["clauses"][number] = {
  id: "processed-item",
  enabled: true,
  trigger: "process",
  points: 10,
  eligibleOnly: true,
  materials: ["plastic", "aluminium"],
  repetition: "once_per_item",
};

const vulnerablePolicy: Policy = {
  schemaVersion: 1,
  clauses: [
    processReward,
    {
      id: "hopper-batch",
      enabled: true,
      trigger: "hopper_threshold",
      points: 5,
      eligibleOnly: true,
      materials: ["plastic", "aluminium"],
      repetition: "every_event",
      batchSize: 3,
    },
  ],
};

const receiptBackedPolicy: Policy = {
  ...vulnerablePolicy,
  clauses: [
    processReward,
    {
      ...vulnerablePolicy.clauses[1]!,
      id: "receipt-batch",
      trigger: "processed_batch",
    },
  ],
};

const rightToHopper = Array.from({ length: 4 }, () => ({
  type: "move",
  direction: "right",
}) as const);
const leftToInput = Array.from({ length: 4 }, () => ({
  type: "move",
  direction: "left",
}) as const);

function fillHopper(itemIds: readonly string[], fromProcessor = false): Action[] {
  const actions: Action[] = fromProcessor
    ? [
        { type: "move", direction: "up" },
        { type: "move", direction: "up" },
        ...leftToInput,
      ]
    : [{ type: "move", direction: "up" }];
  itemIds.forEach((itemId, index) => {
    actions.push({ type: "take", itemId }, ...rightToHopper, { type: "deposit" });
    if (index < itemIds.length - 1) actions.push(...leftToInput);
  });
  return actions;
}

function honestBatches(batches: readonly (readonly string[])[]): readonly Action[] {
  const actions: Action[] = [];
  batches.forEach((itemIds, index) => {
    actions.push(...fillHopper(itemIds, index > 0));
    actions.push({ type: "move", direction: "down" }, { type: "move", direction: "down" });
    for (const itemId of itemIds) actions.push({ type: "process", itemId });
  });
  actions.push({ type: "finish" });
  return actions;
}

const cyclingExploit: readonly Action[] = [
  ...fillHopper(["B1", "B2", "B3"]),
  { type: "retrieve", itemId: "B3" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B3" },
  { type: "deposit" },
  { type: "finish" },
];

describe("interacting batch-bonus benchmark", () => {
  it("rewards cycling the third hopper item under the vulnerable rule only", () => {
    const initialState = createBottleReturnState();
    const vulnerable = replayActions(initialState, cyclingExploit, vulnerablePolicy);
    const patched = replayActions(initialState, cyclingExploit, receiptBackedPolicy);

    expect(vulnerable.state.rewardLedger.totalPoints).toBe(15);
    expect(vulnerable.state.outcomeLedger.processedEligibleItemIds).toEqual([]);
    expect(vulnerable.payouts.map((payout) => payout.clauseId)).toEqual([
      "hopper-batch",
      "hopper-batch",
      "hopper-batch",
    ]);
    expect(patched.state.rewardLedger.totalPoints).toBe(0);
    expect(patched.payouts).toEqual([]);
  });

  it.each([
    { batches: [["B1", "B2", "B3"]], reward: 35, bonuses: 1 },
    {
      batches: [["B1", "B2", "B3"], ["C1", "C2", "C3"]],
      reward: 70,
      bonuses: 2,
    },
  ])("preserves honest rewards for $bonuses completed batches", ({ batches, reward, bonuses }) => {
    const actions = honestBatches(batches);
    for (const policy of [vulnerablePolicy, receiptBackedPolicy]) {
      const replay = replayActions(createBottleReturnState(), actions, policy);
      expect(replay.events.filter((event) => !event.success)).toEqual([]);
      expect(replay.state.rewardLedger.totalPoints).toBe(reward);
      expect(replay.state.outcomeLedger.processedEligibleItemIds).toHaveLength(bonuses * 3);
      expect(replay.payouts.filter((payout) => payout.amount === 5)).toHaveLength(bonuses);
    }
  });
});
