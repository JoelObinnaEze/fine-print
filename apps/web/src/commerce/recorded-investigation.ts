import {
  commerceGoal,
  commerceRepairCandidates,
  createCommerceState,
  createHonestCustomerActions,
  evaluateCommerceDesign,
  evaluateCommercePopulation,
  minimizeCommerceExploit,
  refundAttackActions,
  replayCommerce,
  verifyCommerceExploit,
  vulnerableCommercePolicy,
  type CommerceAction,
  type CommerceDesignEvaluation,
  type CommerceGoal,
  type CommercePolicy,
  type CommercePopulationResult,
} from "../../../../packages/commerce/src/index.js";

export const commerceSourceText =
  "Give both people $10 credit when a referred customer completes a $20 purchase. Customers can return purchases within 30 days. Issued credit remains after a refund, and promotional credit counts toward the threshold.";

export const commerceRestrictions = "Keep a legitimate $10 reward for both people";

export interface CommerceInvestigationView {
  readonly id: string;
  readonly replayed: boolean;
  readonly modelId: string;
  readonly provenance?: "recorded" | "live";
  readonly mapping: {
    readonly status: "candidate" | "unsupported";
    readonly reason: string;
    readonly policy: CommercePolicy | null;
    readonly supportedClauses: readonly string[];
    readonly unsupportedConditions: readonly string[];
  };
  readonly attack: {
    readonly hypothesis: string;
    readonly proposedActionCount: number;
    readonly minimizedActions: readonly CommerceAction[];
    readonly verification: {
      readonly status: "exploit_verified" | "no_exploit" | "candidate_invalid";
      readonly availableRewardUsd: number;
      readonly retainedRevenueUsd: number;
      readonly unintendedPayoutUsd: number;
      readonly reason: string;
    };
    readonly events: readonly {
      readonly sequence: number;
      readonly day: number;
      readonly action: CommerceAction["type"];
      readonly clause: string;
      readonly summary: string;
      readonly ledgerEffect: string;
    }[];
  } | null;
  readonly candidates: readonly {
    readonly id: string;
    readonly label: string;
    readonly tradeoff: string;
    readonly complexity: number;
    readonly policy: CommercePolicy;
    readonly evaluation: CommerceDesignEvaluation;
    readonly population: CommercePopulationResult;
  }[];
  readonly population: CommercePopulationResult | null;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
    readonly actualUsd: number;
  };
}

export type CommercePriority =
  | "low_leakage"
  | "fast_rewards"
  | "simple_operations"
  | "least_disruption";

function createRecordedInvestigation(): CommerceInvestigationView {
  const minimizedActions = minimizeCommerceExploit(
    createCommerceState(),
    refundAttackActions,
    vulnerableCommercePolicy,
    commerceGoal,
  );
  const attackReplay = replayCommerce(
    createCommerceState(),
    minimizedActions,
    vulnerableCommercePolicy,
  );
  return {
    id: "recorded-commerce-refund-v1",
    replayed: false,
    modelId: "muse-spark-1.3",
    provenance: "recorded",
    mapping: {
      status: "candidate",
      reason: "The recorded model mapping is fully expressible in the commerce simulator.",
      policy: vulnerableCommercePolicy,
      supportedClauses: [
        "$10 to each account",
        "$20 gross purchase threshold",
        "30-day return window",
        "credit remains after refund",
        "promotional credit counts toward threshold",
      ],
      unsupportedConditions: [],
    },
    attack: {
      hypothesis:
        "A referred customer may qualify both accounts, then refund while the issued credit remains spendable.",
      proposedActionCount: refundAttackActions.length,
      minimizedActions,
      verification: verifyCommerceExploit(attackReplay, commerceGoal),
      events: attackReplay.events,
    },
    candidates: commerceRepairCandidates.map((candidate) => ({
      ...candidate,
      evaluation: evaluateCommerceDesign(
        candidate.policy,
        commerceGoal,
        minimizedActions,
        createHonestCustomerActions(vulnerableCommercePolicy),
      ),
      population: evaluateCommercePopulation(candidate.policy, commerceGoal),
    })),
    population: evaluateCommercePopulation(vulnerableCommercePolicy, commerceGoal),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, actualUsd: 0 },
  };
}

export const recordedCommerceInvestigation = createRecordedInvestigation();

export function rankCommerceCandidates(
  candidates: CommerceInvestigationView["candidates"],
  priority: CommercePriority,
): readonly CommerceInvestigationView["candidates"][number][] {
  return [...candidates].sort((left, right) => {
    const leftDelay = left.evaluation.honest.rewardDelayDays ?? 999;
    const rightDelay = right.evaluation.honest.rewardDelayDays ?? 999;
    if (priority === "fast_rewards" && leftDelay !== rightDelay) return leftDelay - rightDelay;
    if (priority === "simple_operations" && left.complexity !== right.complexity) {
      return left.complexity - right.complexity;
    }
    if (priority === "least_disruption") {
      const preserved = Number(right.evaluation.honestRewardsPreserved) - Number(left.evaluation.honestRewardsPreserved);
      if (preserved !== 0) return preserved;
    }
    const leakage =
      left.evaluation.attack.verifiedUnintendedPayoutUsd -
      right.evaluation.attack.verifiedUnintendedPayoutUsd;
    if (leakage !== 0) return leakage;
    if (left.complexity !== right.complexity) return left.complexity - right.complexity;
    return leftDelay - rightDelay;
  });
}

export function commercePolicyText(policy: CommercePolicy): string {
  const issuance =
    policy.referral.issuance === "immediate"
      ? "immediately as spendable credit"
      : policy.referral.issuance === "pending"
        ? "as pending credit until the return window closes"
        : "only after the return window closes";
  return `Give both people $${policy.referral.rewardUsd} when a referred customer qualifies on ${policy.referral.qualificationBasis.replaceAll("_", " ")} of $${policy.referral.qualifyingPurchaseUsd}. Issue it ${issuance}. ${policy.referral.refundHandling === "reverse" ? "Reverse the credit after a refund." : "Keep issued credit after a refund."}`;
}

export function createCommerceGoal(minimumUsd: number): CommerceGoal {
  return {
    metric: "retained_revenue",
    minimumUsd,
    description: `Acquire a referred customer who contributes at least $${minimumUsd} in retained revenue.`,
  };
}
