import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  parseAction,
} from "../../packages/engine/src/index.js";

describe("Bottle Return initial state", () => {
  it("contains the specified worker, stations, and eight stable items", () => {
    const state = createBottleReturnState();

    expect(state).toMatchObject({
      schemaVersion: 1,
      seed: "bottle-return-v1",
      width: 9,
      height: 7,
      tick: 0,
      horizon: 120,
      worker: { position: { x: 1, y: 3 } },
      terminal: false,
      stations: {
        input: { x: 1, y: 1 },
        hopper: { x: 6, y: 2 },
        processor: { x: 6, y: 4 },
        reject: { x: 3, y: 5 },
      },
    });
    expect(state.items).toHaveLength(8);
    expect(state.items.filter((item) => item.eligible)).toHaveLength(6);
    expect(new Set(state.items.map((item) => item.id)).size).toBe(8);
    expect(state.items.every((item) => item.locus.kind === "input")).toBe(true);
  });
});

describe("parseAction", () => {
  it("accepts a supported action", () => {
    expect(parseAction({ type: "move", direction: "right" })).toEqual({
      type: "move",
      direction: "right",
    });
  });

  it("rejects unknown actions and extra fields", () => {
    expect(() => parseAction({ type: "teleport", x: 4, y: 4 })).toThrow();
    expect(() => parseAction({ type: "wait", reward: 10 })).toThrow();
  });
});
