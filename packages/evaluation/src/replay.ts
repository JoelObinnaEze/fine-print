import type { Action } from "../../engine/src/actions.js";
import { step } from "../../engine/src/step.js";
import type { EngineEvent, WorldState } from "../../engine/src/types.js";
import { evaluatePayouts } from "../../policy/src/receipts.js";
import type { Payout } from "../../policy/src/receipts.js";
import type { Policy } from "../../policy/src/schema.js";

import { evaluateOutcome } from "./oracle.js";

export interface ReplayResult {
  readonly state: WorldState;
  readonly events: readonly EngineEvent[];
  readonly payouts: readonly Payout[];
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
