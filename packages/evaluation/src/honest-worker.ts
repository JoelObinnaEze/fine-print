import type { Action } from "../../engine/src/actions.js";
import { isAdjacent, isWalkable } from "../../engine/src/legal-actions.js";
import { step } from "../../engine/src/step.js";
import type { Position, WorldState } from "../../engine/src/types.js";

const directions = [
  ["up", 0, -1],
  ["right", 1, 0],
  ["down", 0, 1],
  ["left", -1, 0],
] as const;

function pathToAdjacent(
  state: WorldState,
  target: Position,
): readonly Extract<Action, { type: "move" }>[] {
  const queue: Array<{
    position: Position;
    path: readonly Extract<Action, { type: "move" }>[];
  }> = [{ position: state.worker.position, path: [] }];
  const visited = new Set([`${state.worker.position.x},${state.worker.position.y}`]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (isAdjacent(current.position, target)) return current.path;

    for (const [direction, dx, dy] of directions) {
      const position = { x: current.position.x + dx, y: current.position.y + dy };
      const key = `${position.x},${position.y}`;
      if (visited.has(key) || !isWalkable(state, position)) continue;
      visited.add(key);
      queue.push({
        position,
        path: [...current.path, { type: "move", direction }],
      });
    }
  }

  throw new Error("station has no reachable service square");
}

export function createHonestWorkerActions(
  initialState: WorldState,
  itemOrder: readonly string[] = initialState.items
    .filter((item) => item.eligible)
    .map((item) => item.id),
): readonly Action[] {
  const eligibleItemIds = initialState.items
    .filter((item) => item.eligible)
    .map((item) => item.id);
  if (
    itemOrder.length !== eligibleItemIds.length ||
    new Set(itemOrder).size !== itemOrder.length ||
    itemOrder.some((itemId) => !eligibleItemIds.includes(itemId))
  ) {
    throw new Error("honest worker order must contain every eligible item exactly once");
  }

  let state = initialState;
  const actions: Action[] = [];
  const append = (action: Action) => {
    const result = step(state, action);
    if (result.events[0]?.success !== true) {
      throw new Error(`honest worker produced an invalid ${action.type} action`);
    }
    actions.push(action);
    state = result.nextState;
  };

  for (const itemId of itemOrder) {
    for (const move of pathToAdjacent(state, state.stations.input)) append(move);
    append({ type: "take", itemId });
    for (const move of pathToAdjacent(state, state.stations.hopper)) append(move);
    append({ type: "deposit" });
    for (const move of pathToAdjacent(state, state.stations.processor)) append(move);
    append({ type: "process", itemId });
  }

  if (!state.terminal) append({ type: "finish" });
  return actions;
}
