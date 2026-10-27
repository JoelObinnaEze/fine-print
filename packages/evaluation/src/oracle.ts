import type {
  EngineEvent,
  OutcomeLedger,
  WorldState,
} from "../../engine/src/index.js";

export function evaluateOutcome(
  stateBefore: WorldState,
  event: EngineEvent,
  ledger: OutcomeLedger = stateBefore.outcomeLedger,
): OutcomeLedger {
  if (!event.success || event.kind !== "process" || event.itemId === null) {
    return ledger;
  }

  const item = stateBefore.items.find((candidate) => candidate.id === event.itemId);
  if (!item) return ledger;

  if (item.eligible) {
    return ledger.processedEligibleItemIds.includes(item.id)
      ? ledger
      : {
          ...ledger,
          processedEligibleItemIds: [...ledger.processedEligibleItemIds, item.id],
        };
  }

  return ledger.contaminationItemIds.includes(item.id)
    ? ledger
    : {
        ...ledger,
        contaminationItemIds: [...ledger.contaminationItemIds, item.id],
      };
}
