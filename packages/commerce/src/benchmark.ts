import type { CommerceAction, CommerceGoal, CommercePolicy } from "./contracts.js";
import {
  CommerceSimulationError,
  createCommerceState,
  replayCommerce,
  type CommerceReplay,
  type CommerceState,
} from "./simulator.js";

export const commerceGoal: CommerceGoal = {
  metric: "retained_revenue",
  minimumUsd: 20,
  description: "Acquire a referred customer who contributes at least $20 in retained revenue.",
};

export const vulnerableCommercePolicy: CommercePolicy = {
  schemaVersion: 1,
  name: "Immediate referral credit",
  referral: {
    rewardUsd: 10,
    qualifyingPurchaseUsd: 20,
    qualificationBasis: "gross_purchase",
    issuance: "immediate",
    refundHandling: "keep",
    returnWindowDays: 30,
    promoCreditCountsTowardThreshold: true,
  },
};

export function createRefundAttackActions(
  policy: CommercePolicy,
): readonly CommerceAction[] {
  return [
    { type: "refer", referrerId: "A", customerId: "B" },
    {
      type: "purchase",
      accountId: "B",
      purchaseId: "P1",
      priceUsd: policy.referral.qualifyingPurchaseUsd,
      promoCreditUsd: 0,
    },
    { type: "refund", accountId: "B", purchaseId: "P1" },
  ];
}

export function createHonestCustomerActions(
  policy: CommercePolicy,
): readonly CommerceAction[] {
  return [
    { type: "refer", referrerId: "A", customerId: "B" },
    {
      type: "purchase",
      accountId: "B",
      purchaseId: "H1",
      priceUsd: policy.referral.qualifyingPurchaseUsd,
      promoCreditUsd: 0,
    },
    { type: "advance_days", days: policy.referral.returnWindowDays },
  ];
}

export const refundAttackActions = createRefundAttackActions(vulnerableCommercePolicy);
export const honestCustomerActions = createHonestCustomerActions(vulnerableCommercePolicy);

export interface CommerceRepairCandidate {
  readonly id: "delay" | "pending_reversal" | "net_retained";
  readonly label: string;
  readonly tradeoff: string;
  readonly complexity: 1 | 2 | 3;
  readonly policy: CommercePolicy;
}

export const commerceRepairCandidates: readonly CommerceRepairCandidate[] = [
  {
    id: "delay",
    label: "Delay credit until returns close",
    tradeoff: "Simple evidence rule; customers wait through the full return window.",
    complexity: 1,
    policy: {
      ...vulnerableCommercePolicy,
      name: "Return-window delayed credit",
      referral: {
        ...vulnerableCommercePolicy.referral,
        issuance: "after_return_window",
        refundHandling: "reverse",
      },
    },
  },
  {
    id: "pending_reversal",
    label: "Show pending credit and reverse refunds",
    tradeoff: "Faster feedback, but pending and reversal states add accounting complexity.",
    complexity: 3,
    policy: {
      ...vulnerableCommercePolicy,
      name: "Pending reversible referral credit",
      referral: {
        ...vulnerableCommercePolicy.referral,
        issuance: "pending",
        refundHandling: "reverse",
      },
    },
  },
  {
    id: "net_retained",
    label: "Qualify on net retained spending",
    tradeoff: "Aligns the reward with business value, but requires retained-spend accounting.",
    complexity: 2,
    policy: {
      ...vulnerableCommercePolicy,
      name: "Net retained spend qualification",
      referral: {
        ...vulnerableCommercePolicy.referral,
        qualificationBasis: "net_retained_spend",
        issuance: "after_return_window",
        refundHandling: "reverse",
        promoCreditCountsTowardThreshold: false,
      },
    },
  },
];

export interface CommerceExploitVerification {
  readonly status: "exploit_verified" | "no_exploit";
  readonly availableRewardUsd: number;
  readonly unrecoveredRewardUsd: number;
  readonly retainedRevenueUsd: number;
  readonly unintendedPayoutUsd: number;
  readonly reason: string;
}

function availableRewardUsd(replay: CommerceReplay): number {
  return replay.state.rewards
    .filter((reward) => reward.status === "available")
    .reduce((total, reward) => total + reward.amountUsd, 0);
}

export function verifyCommerceExploit(
  replay: CommerceReplay,
  goal: CommerceGoal,
): CommerceExploitVerification {
  const available = availableRewardUsd(replay);
  const unrecovered = replay.state.accounts.reduce(
    (total, account) => total + account.reversalDebtUsd,
    0,
  );
  const retained = replay.state.retainedRevenueUsd;
  const exposedReward = available + unrecovered;
  const isExploit = retained < goal.minimumUsd && exposedReward > 0;
  return {
    status: isExploit ? "exploit_verified" : "no_exploit",
    availableRewardUsd: available,
    unrecoveredRewardUsd: unrecovered,
    retainedRevenueUsd: retained,
    unintendedPayoutUsd: isExploit ? exposedReward : 0,
    reason: isExploit
      ? unrecovered > 0 && available === 0
        ? `$${unrecovered} of issued reward had already been spent and remained unrecovered while retained revenue was $${retained}, below the $${goal.minimumUsd} intended outcome.`
        : unrecovered === 0
          ? `$${available} became spendable while retained revenue was $${retained}, below the $${goal.minimumUsd} intended outcome.`
          : `$${exposedReward} remained spendable or unrecovered while retained revenue was $${retained}, below the $${goal.minimumUsd} intended outcome.`
      : `No spendable or unrecovered reward value was observed below the $${goal.minimumUsd} retained-revenue outcome.`,
  };
}

export function minimizeCommerceExploit(
  initialState: CommerceState,
  inputActions: readonly CommerceAction[],
  policy: CommercePolicy,
  goal: CommerceGoal,
): readonly CommerceAction[] {
  if (
    verifyCommerceExploit(replayCommerce(initialState, inputActions, policy), goal).status !==
    "exploit_verified"
  ) {
    throw new CommerceSimulationError("Trace does not contain a verified commerce exploit");
  }
  let actions = [...inputActions];
  let index = 0;
  while (index < actions.length) {
    const candidate = actions.filter((_action, candidateIndex) => candidateIndex !== index);
    try {
      const verification = verifyCommerceExploit(
        replayCommerce(initialState, candidate, policy),
        goal,
      );
      if (verification.status === "exploit_verified") {
        actions = candidate;
        index = 0;
        continue;
      }
    } catch (error) {
      if (!(error instanceof CommerceSimulationError)) throw error;
    }
    index += 1;
  }
  return actions;
}

export interface CommerceActionSearchResult {
  readonly status: "failure_found" | "no_failure_found";
  readonly actions: readonly CommerceAction[];
  readonly verification: CommerceExploitVerification;
  readonly expandedStates: number;
}

function nextCommerceActions(
  state: CommerceState,
  policy: CommercePolicy,
): readonly CommerceAction[] {
  const actions: CommerceAction[] = [];
  if (state.referrals.length === 0) {
    actions.push({ type: "refer", referrerId: state.accounts[0]!.id, customerId: state.accounts[1]!.id });
  }
  const purchaseId = `P${state.purchases.length + 1}`;
  const prices = [...new Set([
    policy.referral.qualifyingPurchaseUsd,
    policy.referral.rewardUsd,
  ])];
  for (const account of state.accounts) {
    for (const priceUsd of prices) {
      const promoOptions = [...new Set([0, Math.min(account.availableCreditUsd, priceUsd)])];
      for (const promoCreditUsd of promoOptions) {
        actions.push({ type: "purchase", accountId: account.id, purchaseId, priceUsd, promoCreditUsd });
      }
    }
  }
  for (const purchase of state.purchases) {
    if (purchase.status === "active") {
      actions.push({ type: "refund", accountId: purchase.accountId, purchaseId: purchase.id });
    }
  }
  actions.push({ type: "advance_days", days: 1 });
  if (policy.referral.returnWindowDays !== 1) {
    actions.push({ type: "advance_days", days: policy.referral.returnWindowDays });
  }
  return actions;
}

export function runCommerceActionSearch(
  initialState: CommerceState,
  policy: CommercePolicy,
  goal: CommerceGoal,
  limits: { readonly maxActions: number; readonly maxExpandedStates: number },
): CommerceActionSearchResult {
  const initialReplay = replayCommerce(initialState, [], policy);
  const queue: { readonly state: CommerceState; readonly actions: readonly CommerceAction[] }[] = [
    { state: initialReplay.state, actions: [] },
  ];
  const visited = new Set([JSON.stringify(initialReplay.state)]);
  let expandedStates = 0;
  while (queue.length > 0 && expandedStates < limits.maxExpandedStates) {
    const current = queue.shift()!;
    if (current.actions.length >= limits.maxActions) continue;
    expandedStates += 1;
    for (const action of nextCommerceActions(current.state, policy)) {
      const actions = [...current.actions, action];
      let replay: CommerceReplay;
      try {
        replay = replayCommerce(initialState, actions, policy);
      } catch (error) {
        if (error instanceof CommerceSimulationError) continue;
        throw error;
      }
      const verification = verifyCommerceExploit(replay, goal);
      if (verification.status === "exploit_verified") {
        return { status: "failure_found", actions, verification, expandedStates };
      }
      const key = JSON.stringify(replay.state);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ state: replay.state, actions });
      }
    }
  }
  return {
    status: "no_failure_found",
    actions: [],
    verification: verifyCommerceExploit(initialReplay, goal),
    expandedStates,
  };
}

export interface CommerceStrategyMetrics {
  readonly availableRewardUsd: number;
  readonly unrecoveredRewardUsd: number;
  readonly pendingRewardUsd: number;
  readonly reversedRewardUsd: number;
  readonly retainedRevenueUsd: number;
  readonly verifiedUnintendedPayoutUsd: number;
  readonly rewardDelayDays: number | null;
}

export interface CommerceDesignEvaluation {
  readonly attack: CommerceStrategyMetrics;
  readonly honest: CommerceStrategyMetrics;
  readonly knownAttackBlocked: boolean;
  readonly honestRewardsPreserved: boolean;
}

export interface CommerceAttackEvidence {
  readonly id: string;
  readonly sourcePolicyHash: string;
  readonly initialState?: CommerceState;
  readonly actions: readonly CommerceAction[];
}

export interface CommerceEvidenceEvaluation extends CommerceDesignEvaluation {
  readonly evidence: {
    readonly applicableCases: number;
    readonly blockedCases: number;
    readonly highestObservedExposureUsd: number;
    readonly worstCaseId: string | null;
  };
}

export function calculateCommerceStrategyMetrics(
  replay: CommerceReplay,
  goal: CommerceGoal,
): CommerceStrategyMetrics {
  const verification = verifyCommerceExploit(replay, goal);
  const rewards = replay.state.rewards;
  const availableRewards = rewards.filter((reward) => reward.status === "available");
  const available = availableRewards.reduce((total, reward) => total + reward.amountUsd, 0);
  return {
    availableRewardUsd: available,
    unrecoveredRewardUsd: verification.unrecoveredRewardUsd,
    pendingRewardUsd: rewards
      .filter((reward) => reward.status === "pending" || reward.status === "scheduled")
      .reduce((total, reward) => total + reward.amountUsd, 0),
    reversedRewardUsd: rewards
      .filter((reward) => reward.status === "reversed")
      .reduce((total, reward) => total + reward.amountUsd, 0),
    retainedRevenueUsd: replay.state.retainedRevenueUsd,
    verifiedUnintendedPayoutUsd: verification.unintendedPayoutUsd,
    rewardDelayDays:
      availableRewards.length === 0
        ? null
        : Math.max(
            ...availableRewards.map((reward) => reward.availableDay - reward.createdDay),
          ),
  };
}

export function evaluateCommerceDesign(
  policy: CommercePolicy,
  goal: CommerceGoal,
  attackActions: readonly CommerceAction[],
  honestActions: readonly CommerceAction[],
  initialState: CommerceState = createCommerceState(),
): CommerceDesignEvaluation {
  let attackReplay = replayCommerce(initialState, [], policy);
  for (let length = 1; length <= attackActions.length; length += 1) {
    try {
      attackReplay = replayCommerce(initialState, attackActions.slice(0, length), policy);
    } catch (error) {
      if (!(error instanceof CommerceSimulationError)) throw error;
      break;
    }
  }
  const attack = calculateCommerceStrategyMetrics(
    attackReplay,
    goal,
  );
  const honest = calculateCommerceStrategyMetrics(
    replayCommerce(initialState, honestActions, policy),
    goal,
  );
  return {
    attack,
    honest,
    knownAttackBlocked: attack.verifiedUnintendedPayoutUsd === 0,
    honestRewardsPreserved:
      honest.retainedRevenueUsd >= goal.minimumUsd &&
      honest.availableRewardUsd === policy.referral.rewardUsd * 2,
  };
}

export function evaluateCommerceDesignAgainstEvidence(
  policy: CommercePolicy,
  goal: CommerceGoal,
  sourcePolicyHash: string,
  evidence: readonly CommerceAttackEvidence[],
  honestActions: readonly CommerceAction[],
): CommerceEvidenceEvaluation {
  const applicable = evidence.filter((attack) => attack.sourcePolicyHash === sourcePolicyHash);
  const evaluations = applicable.map((attack) => ({
    id: attack.id,
    result: evaluateCommerceDesign(
      policy,
      goal,
      attack.actions,
      honestActions,
      attack.initialState ?? createCommerceState(),
    ),
  }));
  const fallback = evaluateCommerceDesign(policy, goal, [], honestActions);
  const worst = evaluations.reduce<(typeof evaluations)[number] | null>(
    (current, candidate) =>
      current === null ||
      candidate.result.attack.verifiedUnintendedPayoutUsd >
        current.result.attack.verifiedUnintendedPayoutUsd
        ? candidate
        : current,
    null,
  );
  const selected = worst?.result ?? fallback;
  return {
    ...selected,
    knownAttackBlocked: evaluations.every(
      ({ result }) => result.attack.verifiedUnintendedPayoutUsd === 0,
    ),
    evidence: {
      applicableCases: evaluations.length,
      blockedCases: evaluations.filter(
        ({ result }) => result.attack.verifiedUnintendedPayoutUsd === 0,
      ).length,
      highestObservedExposureUsd:
        worst?.result.attack.verifiedUnintendedPayoutUsd ?? 0,
      worstCaseId: worst?.id ?? null,
    },
  };
}
