import type { Action } from "../../../packages/engine/src/actions.js";
import { createBottleReturnState } from "../../../packages/engine/src/scenario.js";
import { replayActions, type ReplayResult } from "../../../packages/evaluation/src/replay.js";
import type { Policy } from "../../../packages/policy/src/schema.js";

export const startingPolicy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "deposit-reward",
      enabled: true,
      trigger: "deposit",
      points: 10,
      eligibleOnly: false,
      materials: ["plastic", "aluminium", "carton", "rubbish"],
      repetition: "every_event",
    },
  ],
};

export const exploitActions: readonly Action[] = [
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

const initialState = createBottleReturnState();

export interface ReplayFrame extends ReplayResult {
  readonly action: Action | null;
}

export const replayFrames: readonly ReplayFrame[] = Array.from(
  { length: exploitActions.length + 1 },
  (_, index) => ({
    ...replayActions(initialState, exploitActions.slice(0, index), startingPolicy),
    action: index === 0 ? null : exploitActions[index - 1]!,
  }),
);
