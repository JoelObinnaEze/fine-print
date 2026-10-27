import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  type Action,
} from "../../packages/engine/src/index.js";
import { replayActions } from "../../packages/evaluation/src/index.js";
import type { Policy } from "../../packages/policy/src/index.js";

const allMaterials = ["plastic", "aluminium", "carton", "rubbish"] as const;

const repeatedDepositPolicy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "deposit-reward",
      enabled: true,
      trigger: "deposit",
      points: 10,
      eligibleOnly: false,
      materials: [...allMaterials],
      repetition: "every_event",
    },
  ],
};

const oncePerItemDepositPolicy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      ...repeatedDepositPolicy.clauses[0]!,
      repetition: "once_per_item",
    },
  ],
};

const eligibleProcessPolicy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "process-eligible",
      enabled: true,
      trigger: "process",
      points: 10,
      eligibleOnly: true,
      materials: ["plastic", "aluminium"],
      repetition: "once_per_item",
    },
  ],
};

const repeatedDepositTrace: readonly Action[] = [
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

function honestProcessingTrace(itemIds: readonly string[]): readonly Action[] {
  const actions: Action[] = [{ type: "move", direction: "up" }];

  for (const [index, itemId] of itemIds.entries()) {
    if (index > 0) {
      actions.push(
        { type: "move", direction: "up" },
        { type: "move", direction: "up" },
        { type: "move", direction: "left" },
        { type: "move", direction: "left" },
        { type: "move", direction: "left" },
        { type: "move", direction: "left" },
      );
    }
    actions.push(
      { type: "take", itemId },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "move", direction: "right" },
      { type: "deposit" },
      { type: "move", direction: "down" },
      { type: "move", direction: "down" },
      { type: "process", itemId },
    );
  }

  return actions;
}

describe("reward and outcome separation", () => {
  it("pays 30 for three deposits while useful recycling remains zero", () => {
    const result = replayActions(
      createBottleReturnState(),
      repeatedDepositTrace,
      repeatedDepositPolicy,
    );

    expect(result.state.rewardLedger.totalPoints).toBe(30);
    expect(result.state.outcomeLedger.processedEligibleItemIds).toEqual([]);
    expect(result.payouts).toHaveLength(3);
  });

  it("reduces the repeated-deposit trace to one payment without inventing useful work", () => {
    const result = replayActions(
      createBottleReturnState(),
      repeatedDepositTrace,
      oncePerItemDepositPolicy,
    );

    expect(result.state.rewardLedger.totalPoints).toBe(10);
    expect(result.state.outcomeLedger.processedEligibleItemIds).toEqual([]);
    expect(result.payouts).toHaveLength(1);
  });

  it("pays all six honestly processed eligible items", () => {
    const eligibleItemIds = ["B1", "B2", "B3", "C1", "C2", "C3"];
    const result = replayActions(
      createBottleReturnState(),
      honestProcessingTrace(eligibleItemIds),
      eligibleProcessPolicy,
    );

    expect(result.state.rewardLedger.totalPoints).toBe(60);
    expect(result.state.outcomeLedger.processedEligibleItemIds).toEqual(
      eligibleItemIds,
    );
    expect(result.state.outcomeLedger.contaminationItemIds).toEqual([]);
  });

  it("records processed rubbish as contamination without useful work or reward", () => {
    const result = replayActions(
      createBottleReturnState(),
      honestProcessingTrace(["R1"]),
      eligibleProcessPolicy,
    );

    expect(result.state.rewardLedger.totalPoints).toBe(0);
    expect(result.state.outcomeLedger.processedEligibleItemIds).toEqual([]);
    expect(result.state.outcomeLedger.contaminationItemIds).toEqual(["R1"]);
  });
});
