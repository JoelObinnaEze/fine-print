import type {
  EngineEvent,
  RewardLedger,
  WorldState,
} from "../../engine/src/index.js";

import type { Policy } from "./schema.js";

export interface PayoutPredicateResults {
  readonly enabled: boolean;
  readonly trigger: boolean;
  readonly eligible: boolean;
  readonly material: boolean;
  readonly repetition: boolean;
}

export interface Payout {
  readonly eventSequence: number;
  readonly clauseId: string;
  readonly itemId: string;
  readonly amount: number;
  readonly predicateResults: PayoutPredicateResults;
}

export interface PayoutEvaluation {
  readonly rewardLedger: RewardLedger;
  readonly payouts: readonly Payout[];
}

export function evaluatePayouts(
  stateBefore: WorldState,
  event: EngineEvent,
  policy: Policy,
): PayoutEvaluation {
  if (!event.success || event.itemId === null) {
    return { rewardLedger: stateBefore.rewardLedger, payouts: [] };
  }

  const item = stateBefore.items.find((candidate) => candidate.id === event.itemId);
  if (!item) {
    return { rewardLedger: stateBefore.rewardLedger, payouts: [] };
  }

  let totalPoints = stateBefore.rewardLedger.totalPoints;
  let rewardedItemIdsByClause = stateBefore.rewardLedger.rewardedItemIdsByClause;
  const payouts: Payout[] = [];

  for (const clause of policy.clauses) {
    const previousItemIds = rewardedItemIdsByClause[clause.id] ?? [];
    const predicateResults: PayoutPredicateResults = {
      enabled: clause.enabled,
      trigger: clause.trigger === event.kind,
      eligible: !clause.eligibleOnly || item.eligible,
      material: clause.materials.includes(item.material),
      repetition:
        clause.repetition === "every_event" || !previousItemIds.includes(item.id),
    };

    if (!Object.values(predicateResults).every(Boolean)) continue;

    payouts.push({
      eventSequence: event.sequence,
      clauseId: clause.id,
      itemId: item.id,
      amount: clause.points,
      predicateResults,
    });
    totalPoints += clause.points;
    rewardedItemIdsByClause = {
      ...rewardedItemIdsByClause,
      [clause.id]: [...previousItemIds, item.id],
    };
  }

  return {
    rewardLedger: { totalPoints, rewardedItemIdsByClause },
    payouts,
  };
}
