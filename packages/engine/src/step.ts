import type { Action } from "./actions.js";
import { inventoryItem, isAdjacent, isWalkable } from "./legal-actions.js";
import type {
  EngineEvent,
  EventKind,
  Item,
  Locus,
  Position,
  WorldState,
} from "./types.js";

export interface StepResult {
  readonly nextState: WorldState;
  readonly events: readonly EngineEvent[];
}

function movedPosition(
  position: Position,
  direction: Extract<Action, { type: "move" }>["direction"],
): Position {
  switch (direction) {
    case "up":
      return { x: position.x, y: position.y - 1 };
    case "down":
      return { x: position.x, y: position.y + 1 };
    case "left":
      return { x: position.x - 1, y: position.y };
    case "right":
      return { x: position.x + 1, y: position.y };
  }
}

function replaceItemLocus(
  items: readonly Item[],
  itemId: string,
  locus: Locus,
): readonly Item[] {
  return items.map((item) => (item.id === itemId ? { ...item, locus } : item));
}

function event(
  state: WorldState,
  kind: EventKind,
  options: {
    readonly itemId?: string;
    readonly from?: Locus;
    readonly to?: Locus;
    readonly success?: boolean;
    readonly reason?: string;
  } = {},
): EngineEvent {
  const tick = state.tick + 1;
  return {
    sequence: tick,
    tick,
    kind,
    itemId: options.itemId ?? null,
    from: options.from ?? null,
    to: options.to ?? null,
    success: options.success ?? true,
    reason: options.reason ?? null,
  };
}

function advance(
  state: WorldState,
  changes: Partial<Pick<WorldState, "worker" | "items" | "terminal">>,
): WorldState {
  const tick = state.tick + 1;
  return {
    ...state,
    ...changes,
    tick,
    terminal: changes.terminal ?? tick >= state.horizon,
  };
}

function reject(state: WorldState, reason: string, itemId?: string): StepResult {
  return {
    nextState: advance(state, {}),
    events: [
      event(state, "action_rejected", {
        ...(itemId === undefined ? {} : { itemId }),
        success: false,
        reason,
      }),
    ],
  };
}

export function step(state: WorldState, action: Action): StepResult {
  if (state.terminal) {
    return { nextState: state, events: [] };
  }

  switch (action.type) {
    case "move": {
      const position = movedPosition(state.worker.position, action.direction);
      if (!isWalkable(state, position)) {
        return reject(state, "destination_blocked");
      }

      return {
        nextState: advance(state, { worker: { position } }),
        events: [event(state, "move")],
      };
    }

    case "take": {
      if (inventoryItem(state)) {
        return reject(state, "inventory_full", action.itemId);
      }

      const item = state.items.find((candidate) => candidate.id === action.itemId);
      if (!item || (item.locus.kind !== "input" && item.locus.kind !== "floor")) {
        return reject(state, "item_unavailable", action.itemId);
      }

      const itemPosition =
        item.locus.kind === "input" ? state.stations.input : item.locus.cell;
      if (!isAdjacent(state.worker.position, itemPosition)) {
        return reject(state, "item_not_adjacent", action.itemId);
      }

      const to: Locus = { kind: "inventory" };
      return {
        nextState: advance(state, {
          items: replaceItemLocus(state.items, item.id, to),
        }),
        events: [
          event(state, "take", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }

    case "deposit": {
      const item = inventoryItem(state);
      if (!item) {
        return reject(state, "inventory_empty");
      }
      if (!isAdjacent(state.worker.position, state.stations.hopper)) {
        return reject(state, "hopper_not_adjacent", item.id);
      }

      const to: Locus = { kind: "hopper" };
      return {
        nextState: advance(state, {
          items: replaceItemLocus(state.items, item.id, to),
        }),
        events: [
          event(state, "deposit", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }

    case "retrieve": {
      if (inventoryItem(state)) {
        return reject(state, "inventory_full", action.itemId);
      }

      const item = state.items.find((candidate) => candidate.id === action.itemId);
      if (!item || item.locus.kind !== "hopper") {
        return reject(state, "item_not_in_hopper", action.itemId);
      }
      if (!isAdjacent(state.worker.position, state.stations.hopper)) {
        return reject(state, "hopper_not_adjacent", item.id);
      }

      const to: Locus = { kind: "inventory" };
      return {
        nextState: advance(state, {
          items: replaceItemLocus(state.items, item.id, to),
        }),
        events: [
          event(state, "retrieve", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }

    case "wait":
      return {
        nextState: advance(state, {}),
        events: [event(state, "wait")],
      };

    case "finish":
      return {
        nextState: advance(state, { terminal: true }),
        events: [event(state, "finish")],
      };

    case "process": {
      const item = state.items.find((candidate) => candidate.id === action.itemId);
      if (!item || item.locus.kind !== "hopper") {
        return reject(state, "item_not_in_hopper", action.itemId);
      }
      if (!isAdjacent(state.worker.position, state.stations.processor)) {
        return reject(state, "processor_not_adjacent", item.id);
      }

      const to: Locus = { kind: "processed" };
      return {
        nextState: {
          ...advance(state, {
            items: replaceItemLocus(state.items, item.id, to),
          }),
          outcomeLedger: item.eligible
            ? {
                ...state.outcomeLedger,
                processedEligibleItemIds: [
                  ...state.outcomeLedger.processedEligibleItemIds,
                  item.id,
                ],
              }
            : {
                ...state.outcomeLedger,
                contaminationItemIds: [
                  ...state.outcomeLedger.contaminationItemIds,
                  item.id,
                ],
              },
        },
        events: [
          event(state, "process", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }

    case "reject": {
      const item = inventoryItem(state);
      if (!item) {
        return reject(state, "inventory_empty");
      }
      if (!isAdjacent(state.worker.position, state.stations.reject)) {
        return reject(state, "reject_not_adjacent", item.id);
      }

      const to: Locus = { kind: "rejected" };
      return {
        nextState: advance(state, {
          items: replaceItemLocus(state.items, item.id, to),
        }),
        events: [
          event(state, "reject", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }

    case "drop": {
      const item = inventoryItem(state);
      if (!item) {
        return reject(state, "inventory_empty");
      }
      const floorOccupied = state.items.some(
        (candidate) =>
          candidate.locus.kind === "floor" &&
          candidate.locus.cell.x === state.worker.position.x &&
          candidate.locus.cell.y === state.worker.position.y,
      );
      if (floorOccupied) {
        return reject(state, "floor_occupied", item.id);
      }

      const to: Locus = { kind: "floor", cell: state.worker.position };
      return {
        nextState: advance(state, {
          items: replaceItemLocus(state.items, item.id, to),
        }),
        events: [
          event(state, "drop", {
            itemId: item.id,
            from: item.locus,
            to,
          }),
        ],
      };
    }
  }
}
