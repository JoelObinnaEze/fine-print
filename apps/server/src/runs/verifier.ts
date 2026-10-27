import { actionSchema, type Action } from "../../../../packages/engine/src/actions.js";
import { canonicalHash } from "../../../../packages/engine/src/canonical-hash.js";
import { ENGINE_VERSION } from "../../../../packages/engine/src/index.js";
import type { WorldState } from "../../../../packages/engine/src/types.js";
import { replayActions } from "../../../../packages/evaluation/src/index.js";
import type { Policy } from "../../../../packages/policy/src/schema.js";
import * as z from "zod";

const candidateSchema = z.array(actionSchema).min(1).max(120);

export type VerificationStatus =
  | "exploit_verified"
  | "no_exploit_in_submitted_trace"
  | "no_exploit_found_within_budget"
  | "candidate_invalid"
  | "run_incomplete";

export interface VerificationResult {
  readonly status: VerificationStatus;
  readonly actions: readonly Action[];
  readonly verifiedActionCount: number;
  readonly invalidActionCount: number;
  readonly totalReward: number;
  readonly usefulItems: number;
  readonly contamination: number;
  readonly excessReward: number;
  readonly stateHash: string | null;
  readonly evidenceEventIds: readonly number[];
}

export function emptyVerification(status: Extract<VerificationStatus, "no_exploit_found_within_budget" | "candidate_invalid" | "run_incomplete">): VerificationResult {
  return {
    status,
    actions: [],
    verifiedActionCount: 0,
    invalidActionCount: 0,
    totalReward: 0,
    usefulItems: 0,
    contamination: 0,
    excessReward: 0,
    stateHash: null,
    evidenceEventIds: [],
  };
}

export function verifyCandidate(
  initialState: WorldState,
  policy: Policy,
  value: unknown,
): VerificationResult {
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) return emptyVerification("candidate_invalid");

  const replay = replayActions(initialState, parsed.data, policy);
  const usefulItemIds = new Set(replay.state.outcomeLedger.processedEligibleItemIds);
  const rewardsByItem = new Map<string, number>();
  for (const payout of replay.payouts) {
    rewardsByItem.set(payout.itemId, (rewardsByItem.get(payout.itemId) ?? 0) + payout.amount);
  }

  const excessItemIds = new Set(
    initialState.items
      .filter((item) => {
        const usefulValue = item.eligible && usefulItemIds.has(item.id) ? 10 : 0;
        return (rewardsByItem.get(item.id) ?? 0) > usefulValue;
      })
      .map((item) => item.id),
  );
  const excessReward = initialState.items.reduce((total, item) => {
    const usefulValue = item.eligible && usefulItemIds.has(item.id) ? 10 : 0;
    return total + Math.max(0, (rewardsByItem.get(item.id) ?? 0) - usefulValue);
  }, 0);

  return {
    status: excessReward > 0 ? "exploit_verified" : "no_exploit_in_submitted_trace",
    actions: parsed.data,
    verifiedActionCount: parsed.data.length,
    invalidActionCount: replay.events.filter((event) => event.kind === "action_rejected").length,
    totalReward: replay.state.rewardLedger.totalPoints,
    usefulItems: usefulItemIds.size,
    contamination: replay.state.outcomeLedger.contaminationItemIds.length,
    excessReward,
    stateHash: canonicalHash({ engineVersion: ENGINE_VERSION, state: replay.state }),
    evidenceEventIds: replay.payouts
      .filter((payout) => excessItemIds.has(payout.itemId))
      .map((payout) => payout.eventSequence),
  };
}
