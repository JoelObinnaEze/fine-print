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

  it("requires adjacency before taking an item", () => {
    const result = step(createBottleReturnState(), { type: "take", itemId: "B1" });

    expect(result.nextState.items.find((item) => item.id === "B1")?.locus).toEqual({
      kind: "input",
    });
    expect(result.events[0]).toMatchObject({
      kind: "action_rejected",
      reason: "item_not_adjacent",
    });
  });

  it("blocks movement past the grid boundary", () => {
    const atLeftEdge = step(createBottleReturnState(), {
      type: "move",
      direction: "left",
    }).nextState;
    const result = step(atLeftEdge, { type: "move", direction: "left" });

    expect(result.nextState.worker.position).toEqual({ x: 0, y: 3 });
    expect(result.events[0]).toMatchObject({
      kind: "action_rejected",
      reason: "destination_blocked",
    });
  });

  it("enforces the one-item inventory capacity", () => {
    const carryingBottle = run(createBottleReturnState(), [
      { type: "move", direction: "up" },
      { type: "take", itemId: "B1" },
    ]).state;
    const result = step(carryingBottle, { type: "take", itemId: "B2" });

    expect(result.nextState.items.find((item) => item.id === "B1")?.locus).toEqual({
      kind: "inventory",
    });
    expect(result.nextState.items.find((item) => item.id === "B2")?.locus).toEqual({
      kind: "input",
    });
    expect(result.events[0]).toMatchObject({
      kind: "action_rejected",
      reason: "inventory_full",
    });
  });

  it("is deterministic for identical state and actions", () => {
    const initialState = createBottleReturnState();

    expect(run(initialState, repeatDepositTrace)).toEqual(
      run(initialState, repeatDepositTrace),
    );
  });

  it("processes an eligible hopper item and records useful recycling", () => {
    const actions: readonly Action[] = [
      ...repeatDepositTrace.slice(0, 7),
      { type: "move", direction: "down" },
      { type: "move", direction: "down" },
      { type: "process", itemId: "B1" },
    ];

    const { state, events } = run(createBottleReturnState(), actions);

    expect(state.items.find((item) => item.id === "B1")?.locus).toEqual({
      kind: "processed",
    });
    expect(state.outcomeLedger.processedEligibleItemIds).toEqual(["B1"]);
    expect(events.at(-1)).toMatchObject({
      kind: "process",
      itemId: "B1",
      success: true,
    });

    const retrieveProcessed = step(state, { type: "retrieve", itemId: "B1" });
    expect(
      retrieveProcessed.nextState.items.find((item) => item.id === "B1")?.locus,
    ).toEqual({ kind: "processed" });
    expect(retrieveProcessed.events[0]).toMatchObject({
      kind: "action_rejected",
      reason: "item_not_in_hopper",
    });
  });

  it("rejects a carried item and drops another item onto the floor", () => {
    const pathToReject: readonly Action[] = [
      { type: "move", direction: "up" },
      { type: "take", itemId: "R1" },
      { type: "move", direction: "down" },
      { type: "move", direction: "down" },
      { type: "move", direction: "down" },
      { type: "move", direction: "right" },
      { type: "reject" },
    ];
    const rejected = run(createBottleReturnState(), pathToReject).state;
    expect(rejected.items.find((item) => item.id === "R1")?.locus).toEqual({
      kind: "rejected",
    });
    const retrieveRejected = step(rejected, { type: "retrieve", itemId: "R1" });
    expect(
      retrieveRejected.nextState.items.find((item) => item.id === "R1")?.locus,
    ).toEqual({ kind: "rejected" });

    const dropped = run(createBottleReturnState(), [
      { type: "move", direction: "up" },
      { type: "take", itemId: "X1" },
      { type: "drop" },
    ]).state;
    expect(dropped.items.find((item) => item.id === "X1")?.locus).toEqual({
      kind: "floor",
      cell: { x: 1, y: 2 },
    });
  });

  it("stops at the horizon and ignores actions after the episode is terminal", () => {
    const almostFinished: WorldState = {
      ...createBottleReturnState(),
      tick: 119,
    };

    const finished = step(almostFinished, { type: "wait" });
    expect(finished.nextState).toMatchObject({ tick: 120, terminal: true });

    const afterTerminal = step(finished.nextState, { type: "move", direction: "up" });
    expect(afterTerminal).toEqual({ nextState: finished.nextState, events: [] });
  });
});
