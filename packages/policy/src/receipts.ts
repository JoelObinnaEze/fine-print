import type {
  EngineEvent,
  RewardLedger,
  WorldState,
} from "../../engine/src/types.js";

import type { Policy, PolicyClause } from "./schema.js";

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

function itemMatchesBatch(item: WorldState["items"][number], clause: PolicyClause): boolean {
  return (!clause.eligibleOnly || item.eligible) && clause.materials.includes(item.material);
}

function triggerMatches(
  stateBefore: WorldState,
  event: EngineEvent,
  item: WorldState["items"][number],
  clause: PolicyClause,
): boolean {
  if (clause.trigger === "deposit" || clause.trigger === "process") {
    return clause.trigger === event.kind;
  }
  const batchSize = clause.batchSize;
  if (batchSize === undefined) return false;
  if (clause.trigger === "hopper_threshold") {
    if (event.kind !== "deposit" || !itemMatchesBatch(item, clause)) return false;
    const hopperItems = stateBefore.items.filter(
      (candidate) => candidate.locus.kind === "hopper" && itemMatchesBatch(candidate, clause),
    ).length;
    return hopperItems + 1 === batchSize;
  }
  if (event.kind !== "process" || !item.eligible || !itemMatchesBatch(item, clause)) return false;
  const processedItems = stateBefore.outcomeLedger.processedEligibleItemIds.filter((itemId) => {
    const processed = stateBefore.items.find((candidate) => candidate.id === itemId);
    return processed ? itemMatchesBatch(processed, clause) : false;
  }).length;
  return (processedItems + 1) % batchSize === 0;
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
      trigger: triggerMatches(stateBefore, event, item, clause),
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
