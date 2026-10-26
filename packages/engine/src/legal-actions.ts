import type { Item, Position, WorldState } from "./types.js";

export function isAdjacent(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

export function isWalkable(state: WorldState, position: Position): boolean {
  if (
    position.x < 0 ||
    position.x >= state.width ||
    position.y < 0 ||
    position.y >= state.height
  ) {
    return false;
  }

  return !Object.values(state.stations).some(
    (station) => station.x === position.x && station.y === position.y,
  );
}

export function inventoryItem(state: WorldState): Item | undefined {
  return state.items.find((item) => item.locus.kind === "inventory");
}
