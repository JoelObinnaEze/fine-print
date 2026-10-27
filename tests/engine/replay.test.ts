import { describe, expect, it } from "vitest";

import {
  canonicalHash,
  createBottleReturnState,
  type Action,
} from "../../packages/engine/src/index.js";
import { hashReplay, replayActions } from "../../packages/evaluation/src/index.js";
import type { Policy } from "../../packages/policy/src/index.js";

const noRewards: Policy = { schemaVersion: 1, clauses: [] };
const actions: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "B1" },
  { type: "finish" },
];

describe("canonical replay hashes", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalHash({ b: 2, nested: { y: 2, x: 1 }, a: 1 })).toBe(
      canonicalHash({ a: 1, nested: { x: 1, y: 2 }, b: 2 }),
    );
    expect(canonicalHash({ values: [1, 2] })).not.toBe(
      canonicalHash({ values: [2, 1] }),
    );
  });

  it("produces identical hashes for identical deterministic replays", () => {
    const first = replayActions(createBottleReturnState(), actions, noRewards);
    const second = replayActions(createBottleReturnState(), actions, noRewards);

    expect(hashReplay(first)).toBe(hashReplay(second));
    expect(hashReplay(first)).toMatch(/^[a-f0-9]{64}$/);
  });
});
