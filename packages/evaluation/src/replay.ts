import {
  canonicalHash,
  ENGINE_VERSION,
  step,
  type Action,
  type EngineEvent,
  type WorldState,
} from "../../engine/src/index.js";
import {
  evaluatePayouts,
  type Payout,
  type Policy,
} from "../../policy/src/index.js";

import { evaluateOutcome } from "./oracle.js";

export interface ReplayResult {
  readonly state: WorldState;
  readonly events: readonly EngineEvent[];
  readonly payouts: readonly Payout[];
}

export function hashReplay(replay: ReplayResult): string {
  return canonicalHash({ engineVersion: ENGINE_VERSION, replay });
}

export function replayActions(
  initialState: WorldState,
  actions: readonly Action[],
  policy: Policy,
): ReplayResult {
  let state = initialState;
  const events: EngineEvent[] = [];
  const payouts: Payout[] = [];

  for (const action of actions) {
    const stateBefore = state;
    const physical = step(stateBefore, action);
    let rewardLedger = stateBefore.rewardLedger;
    let outcomeLedger = stateBefore.outcomeLedger;

    for (const event of physical.events) {
      const payoutEvaluation = evaluatePayouts(
        { ...stateBefore, rewardLedger },
        event,
        policy,
      );
      rewardLedger = payoutEvaluation.rewardLedger;
      outcomeLedger = evaluateOutcome(stateBefore, event, outcomeLedger);
      events.push(event);
      payouts.push(...payoutEvaluation.payouts);
    }

    state = { ...physical.nextState, rewardLedger, outcomeLedger };
  }

  return { state, events, payouts };
}
