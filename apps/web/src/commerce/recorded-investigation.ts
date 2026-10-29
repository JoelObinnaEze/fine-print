import {
  commerceGoal,
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

const recordedMuseCandidates = [
  {
    id: "c1",
    label: "Reverse credit on refund",
    tradeoff: "Preserves the immediate $10 reward for both people, but requires credit reversal after a refund.",
    complexity: 1,
    policy: {
      ...vulnerableCommercePolicy,
      name: "both-10-on-20-reverse",
      referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" },
    },
  },
  {
    id: "c2",
    label: "Pay after return window",
    tradeoff: "Waits 30 days before paying, so honest customers receive the same reward later.",
    complexity: 2,
    policy: {
      ...vulnerableCommercePolicy,
      name: "both-10-on-20-after-window",
      referral: {
        ...vulnerableCommercePolicy.referral,
        issuance: "after_return_window",
        refundHandling: "reverse",
      },
    },
  },
  {
    id: "c3",
    label: "Qualify on retained cash spending",
    tradeoff: "Aligns qualification with lasting cash value, but promotional credit no longer counts.",
    complexity: 2,
    policy: {
      ...vulnerableCommercePolicy,
      name: "both-10-on-20-cash-retained",
      referral: {
        ...vulnerableCommercePolicy.referral,
        qualificationBasis: "net_retained_spend",
        refundHandling: "reverse",
        promoCreditCountsTowardThreshold: false,
      },
    },
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly tradeoff: string;
  readonly complexity: number;
  readonly policy: CommercePolicy;
}[];

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
    id: "243986a6-b49a-4b16-9930-bee96912b6e4",
    replayed: false,
    modelId: "muse-spark-1.3",
    provenance: "recorded",
    mapping: {
      status: "candidate",
      reason: "Muse mapped every payout clause into the simulator without dropping a condition.",
      policy: vulnerableCommercePolicy,
      supportedClauses: [
        "$10 credit to both people",
        "$20 qualifying purchase",
        "immediate issuance",
        "30-day return window",
        "credit remains after a refund",
        "promotional credit counts toward the threshold",
      ],
      unsupportedConditions: [],
    },
    attack: {
      hypothesis:
        "A referred customer can qualify both accounts, refund the purchase, and leave the issued credit spendable.",
      proposedActionCount: 4,
      minimizedActions,
      verification: verifyCommerceExploit(attackReplay, commerceGoal),
      events: attackReplay.events,
    },
    candidates: recordedMuseCandidates.map((candidate) => ({
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
    usage: { promptTokens: 1_000, completionTokens: 2_811, totalTokens: 3_811, actualUsd: 0.013197 },
  };
}

export const recordedCommerceInvestigation = createRecordedInvestigation();

export const recordedCommerceRepairTest = {
  label: "Reverse credit on refund",
  verdict: "No failure found in this attempt",
  leakage: 0,
  honestReward: 20,
  delay: 0,
  provenance: "recorded",
} as const;

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
  const promotionalCredit = policy.referral.promoCreditCountsTowardThreshold
    ? "Promotional credit counts toward the threshold."
    : "Promotional credit does not count toward the threshold.";
  return `Give both people $${policy.referral.rewardUsd} when a referred customer qualifies on ${policy.referral.qualificationBasis.replaceAll("_", " ")} of $${policy.referral.qualifyingPurchaseUsd}. Issue it ${issuance}. Purchases can be returned within ${policy.referral.returnWindowDays} days. ${policy.referral.refundHandling === "reverse" ? "Reverse the credit after a refund." : "Keep issued credit after a refund."} ${promotionalCredit}`;
}

export function createCommerceGoal(minimumUsd: number): CommerceGoal {
  return {
    metric: "retained_revenue",
    minimumUsd,
    description: `Acquire a referred customer who contributes at least $${minimumUsd} in retained revenue.`,
  };
}
