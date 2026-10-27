export const ENGINE_VERSION = "1";

export { actionSchema, parseAction } from "./actions.js";
export { canonicalHash } from "./canonical-hash.js";
export { isAdjacent, isWalkable } from "./legal-actions.js";
export { createBottleReturnState } from "./scenario.js";
export { step } from "./step.js";
export { MATERIALS } from "./types.js";
export type { Action } from "./actions.js";
export type { StepResult } from "./step.js";
export type {
  EngineEvent,
  EventKind,
  Item,
  Locus,
  Material,
  OutcomeLedger,
  Position,
  RewardLedger,
  Stations,
  WorldState,
} from "./types.js";
