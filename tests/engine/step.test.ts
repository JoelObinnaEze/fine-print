import { describe, expect, it } from "vitest";

import {
  createBottleReturnState,
  step,
  type Action,
  type EngineEvent,
  type WorldState,
} from "../../packages/engine/src/index.js";

function run(
  initialState: WorldState,
  actions: readonly Action[],
): { state: WorldState; events: readonly EngineEvent[] } {
  let state = initialState;
  const events: EngineEvent[] = [];

  for (const action of actions) {
    const result = step(state, action);
    state = result.nextState;
    events.push(...result.events);
  }

  return { state, events };
}

const repeatDepositTrace: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "B1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
];

describe("step", () => {
  it("runs a deposit/retrieve loop without duplicating the item", () => {
    const initialState = createBottleReturnState();
    const { state, events } = run(initialState, repeatDepositTrace);

    expect(state.tick).toBe(repeatDepositTrace.length);
    expect(state.items.find((item) => item.id === "B1")?.locus).toEqual({
      kind: "hopper",
    });
    expect(state.items.filter((item) => item.id === "B1")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "deposit")).toHaveLength(2);
    expect(events.find((event) => event.kind === "retrieve")).toMatchObject({
      itemId: "B1",
      from: { kind: "hopper" },
      to: { kind: "inventory" },
      success: true,
    });

    expect(initialState.tick).toBe(0);
    expect(initialState.items.find((item) => item.id === "B1")?.locus).toEqual({
      kind: "input",
    });
  });

  it("rejects an invalid action, consumes one tick, and changes no physical state", () => {
    const initialState = createBottleReturnState();
    const result = step(initialState, { type: "deposit" });

    expect(result.nextState.tick).toBe(1);
    expect(result.nextState.worker).toEqual(initialState.worker);
    expect(result.nextState.items).toEqual(initialState.items);
    expect(result.events).toEqual([
      {
        sequence: 1,
        tick: 1,
        kind: "action_rejected",
        itemId: null,
        from: null,
        to: null,
        success: false,
        reason: "inventory_empty",
      },
    ]);
  });

  it("is deterministic for identical state and actions", () => {
    const initialState = createBottleReturnState();

    expect(run(initialState, repeatDepositTrace)).toEqual(
      run(initialState, repeatDepositTrace),
    );
  });
});
