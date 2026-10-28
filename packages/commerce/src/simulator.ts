import {
  parseCommerceAction,
  parseCommercePolicy,
  type CommerceAction,
  type CommercePolicy,
} from "./contracts.js";

export interface CommerceAccount {
  readonly id: string;
  readonly availableCreditUsd: number;
  readonly pendingCreditUsd: number;
  readonly reversalDebtUsd: number;
}

export interface CommerceReferral {
  readonly id: string;
  readonly referrerId: string;
  readonly customerId: string;
  readonly createdDay: number;
}

export interface CommercePurchase {
  readonly id: string;
  readonly accountId: string;
  readonly priceUsd: number;
  readonly promoCreditUsd: number;
  readonly cashPaidUsd: number;
  readonly purchasedDay: number;
  readonly status: "active" | "refunded";
}

export interface CommerceReward {
  readonly id: string;
  readonly referralId: string;
  readonly purchaseId: string;
  readonly accountId: string;
  readonly amountUsd: number;
  readonly status: "scheduled" | "pending" | "available" | "reversed";
  readonly createdDay: number;
  readonly availableDay: number;
}

export interface CommerceState {
  readonly schemaVersion: 1;
  readonly day: number;
  readonly accounts: readonly CommerceAccount[];
  readonly referrals: readonly CommerceReferral[];
  readonly purchases: readonly CommercePurchase[];
  readonly rewards: readonly CommerceReward[];
  readonly retainedRevenueUsd: number;
}

export interface CommerceEvent {
  readonly sequence: number;
  readonly day: number;
  readonly action: CommerceAction["type"];
  readonly clause: string;
  readonly summary: string;
  readonly ledgerEffect: string;
}

export interface CommerceReplay {
  readonly state: CommerceState;
  readonly events: readonly CommerceEvent[];
}

export class CommerceSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceSimulationError";
  }
}

function accountById(state: CommerceState, id: string): CommerceAccount {
  const account = state.accounts.find((candidate) => candidate.id === id);
  if (!account) throw new CommerceSimulationError(`Account ${id} does not exist`);
  return account;
}

function replaceAccount(
  accounts: readonly CommerceAccount[],
  id: string,
  update: (account: CommerceAccount) => CommerceAccount,
): readonly CommerceAccount[] {
  return accounts.map((account) => (account.id === id ? update(account) : account));
}

function replacePurchase(
  purchases: readonly CommercePurchase[],
  id: string,
  update: (purchase: CommercePurchase) => CommercePurchase,
): readonly CommercePurchase[] {
  return purchases.map((purchase) => (purchase.id === id ? update(purchase) : purchase));
}

function qualificationAmount(
  purchase: CommercePurchase,
  policy: CommercePolicy,
): number {
  if (policy.referral.qualificationBasis === "gross_purchase") {
    return policy.referral.promoCreditCountsTowardThreshold
      ? purchase.priceUsd
      : purchase.cashPaidUsd;
  }
  return purchase.cashPaidUsd;
}

function rewardStatus(policy: CommercePolicy): CommerceReward["status"] {
  if (policy.referral.issuance === "immediate") return "available";
  if (policy.referral.issuance === "pending") return "pending";
  return "scheduled";
}

function formatUsd(value: number): string {
  return `$${value}`;
}

export function createCommerceState(
  accountIds: readonly string[] = ["A", "B"],
): CommerceState {
  if (accountIds.length < 2 || new Set(accountIds).size !== accountIds.length) {
    throw new CommerceSimulationError("Commerce state requires at least two unique accounts");
  }
  return {
    schemaVersion: 1,
    day: 0,
    accounts: accountIds.map((id) => ({
      id,
      availableCreditUsd: 0,
      pendingCreditUsd: 0,
      reversalDebtUsd: 0,
    })),
    referrals: [],
    purchases: [],
    rewards: [],
    retainedRevenueUsd: 0,
  };
}

function issueReferralRewards(
  state: CommerceState,
  purchase: CommercePurchase,
  referral: CommerceReferral,
  policy: CommercePolicy,
): CommerceState {
  if (state.rewards.some((reward) => reward.referralId === referral.id)) return state;
  if (qualificationAmount(purchase, policy) < policy.referral.qualifyingPurchaseUsd) return state;
  const status = rewardStatus(policy);
  const availableDay = state.day + policy.referral.returnWindowDays;
  const rewards = [referral.referrerId, referral.customerId].map(
    (accountId): CommerceReward => ({
      id: `${referral.id}:${purchase.id}:${accountId}`,
      referralId: referral.id,
      purchaseId: purchase.id,
      accountId,
      amountUsd: policy.referral.rewardUsd,
      status,
      createdDay: state.day,
      availableDay,
    }),
  );
  let accounts = state.accounts;
  for (const reward of rewards) {
    accounts = replaceAccount(accounts, reward.accountId, (account) => ({
      ...account,
      availableCreditUsd:
        account.availableCreditUsd + (status === "available" ? reward.amountUsd : 0),
      pendingCreditUsd:
        account.pendingCreditUsd + (status === "pending" ? reward.amountUsd : 0),
    }));
  }
  return { ...state, accounts, rewards: [...state.rewards, ...rewards] };
}

function reverseRewards(
  state: CommerceState,
  purchaseId: string,
): CommerceState {
  let accounts = state.accounts;
  const rewards = state.rewards.map((reward): CommerceReward => {
    if (reward.purchaseId !== purchaseId || reward.status === "reversed") return reward;
    accounts = replaceAccount(accounts, reward.accountId, (account) => {
      if (reward.status === "pending") {
        return {
          ...account,
          pendingCreditUsd: Math.max(0, account.pendingCreditUsd - reward.amountUsd),
        };
      }
      if (reward.status === "available") {
        const recovered = Math.min(account.availableCreditUsd, reward.amountUsd);
        return {
          ...account,
          availableCreditUsd: account.availableCreditUsd - recovered,
          reversalDebtUsd: account.reversalDebtUsd + reward.amountUsd - recovered,
        };
      }
      return account;
    });
    return { ...reward, status: "reversed" };
  });
  return { ...state, accounts, rewards };
}

function releaseRewards(state: CommerceState, policy: CommercePolicy): CommerceState {
  let accounts = state.accounts;
  const rewards = state.rewards.map((reward): CommerceReward => {
    if (
      (reward.status !== "pending" && reward.status !== "scheduled") ||
      reward.availableDay > state.day
    ) {
      return reward;
    }
    const purchase = state.purchases.find((candidate) => candidate.id === reward.purchaseId);
    const canRelease =
      purchase?.status === "active" &&
      qualificationAmount(purchase, policy) >= policy.referral.qualifyingPurchaseUsd;
    if (!canRelease) return { ...reward, status: "reversed" };
    accounts = replaceAccount(accounts, reward.accountId, (account) => ({
      ...account,
      pendingCreditUsd:
        reward.status === "pending"
          ? Math.max(0, account.pendingCreditUsd - reward.amountUsd)
          : account.pendingCreditUsd,
      availableCreditUsd: account.availableCreditUsd + reward.amountUsd,
    }));
    return { ...reward, status: "available" };
  });
  return { ...state, accounts, rewards };
}

function stepCommerce(
  state: CommerceState,
  action: CommerceAction,
  policy: CommercePolicy,
  sequence: number,
): { readonly state: CommerceState; readonly event: CommerceEvent } {
  switch (action.type) {
    case "refer": {
      accountById(state, action.referrerId);
      accountById(state, action.customerId);
      if (action.referrerId === action.customerId) {
        throw new CommerceSimulationError("An account cannot refer itself");
      }
      if (state.referrals.some((referral) => referral.customerId === action.customerId)) {
        throw new CommerceSimulationError("Customer already has a referrer");
      }
      const referral: CommerceReferral = {
        id: `${action.referrerId}->${action.customerId}`,
        referrerId: action.referrerId,
        customerId: action.customerId,
        createdDay: state.day,
      };
      return {
        state: { ...state, referrals: [...state.referrals, referral] },
        event: {
          sequence,
          day: state.day,
          action: action.type,
          clause: "referral relationship",
          summary: `${action.referrerId} referred ${action.customerId}.`,
          ledgerEffect: "Referral relationship recorded",
        },
      };
    }
    case "purchase": {
      const account = accountById(state, action.accountId);
      if (state.purchases.some((purchase) => purchase.id === action.purchaseId)) {
        throw new CommerceSimulationError("Purchase ID already exists");
      }
      if (account.availableCreditUsd < action.promoCreditUsd) {
        throw new CommerceSimulationError("Account does not have enough promotional credit");
      }
      const purchase: CommercePurchase = {
        id: action.purchaseId,
        accountId: action.accountId,
        priceUsd: action.priceUsd,
        promoCreditUsd: action.promoCreditUsd,
        cashPaidUsd: action.priceUsd - action.promoCreditUsd,
        purchasedDay: state.day,
        status: "active",
      };
      let nextState: CommerceState = {
        ...state,
        accounts: replaceAccount(state.accounts, account.id, (candidate) => ({
          ...candidate,
          availableCreditUsd: candidate.availableCreditUsd - action.promoCreditUsd,
        })),
        purchases: [...state.purchases, purchase],
        retainedRevenueUsd: state.retainedRevenueUsd + purchase.cashPaidUsd,
      };
      const referral = state.referrals.find(
        (candidate) => candidate.customerId === action.accountId,
      );
      if (referral) nextState = issueReferralRewards(nextState, purchase, referral, policy);
      const issued = nextState.rewards.length - state.rewards.length;
      return {
        state: nextState,
        event: {
          sequence,
          day: state.day,
          action: action.type,
          clause: "purchase qualification + credit issuance",
          summary: `${action.accountId} bought ${action.purchaseId} for ${formatUsd(action.priceUsd)}.`,
          ledgerEffect:
            issued > 0
              ? `${issued} referral credits created; ${formatUsd(purchase.cashPaidUsd)} retained`
              : `No referral credit; ${formatUsd(purchase.cashPaidUsd)} retained`,
        },
      };
    }
    case "refund": {
      accountById(state, action.accountId);
      const purchase = state.purchases.find((candidate) => candidate.id === action.purchaseId);
      if (!purchase || purchase.accountId !== action.accountId) {
        throw new CommerceSimulationError("Purchase is unavailable to this account");
      }
      if (purchase.status === "refunded") {
        throw new CommerceSimulationError("Purchase was already refunded");
      }
      if (state.day - purchase.purchasedDay > policy.referral.returnWindowDays) {
        throw new CommerceSimulationError("Return window has closed");
      }
      let nextState: CommerceState = {
        ...state,
        accounts: replaceAccount(state.accounts, action.accountId, (account) => ({
          ...account,
          availableCreditUsd: account.availableCreditUsd + purchase.promoCreditUsd,
        })),
        purchases: replacePurchase(state.purchases, purchase.id, (candidate) => ({
          ...candidate,
          status: "refunded",
        })),
        retainedRevenueUsd: state.retainedRevenueUsd - purchase.cashPaidUsd,
      };
      if (policy.referral.refundHandling === "reverse") {
        nextState = reverseRewards(nextState, purchase.id);
      }
      return {
        state: nextState,
        event: {
          sequence,
          day: state.day,
          action: action.type,
          clause:
            policy.referral.refundHandling === "keep"
              ? "refund handling keeps issued credit"
              : "refund handling reverses issued credit",
          summary: `${action.accountId} refunded ${action.purchaseId}.`,
          ledgerEffect: `${formatUsd(purchase.cashPaidUsd)} retained revenue removed`,
        },
      };
    }
    case "advance_days": {
      const advanced = { ...state, day: state.day + action.days };
      const nextState = releaseRewards(advanced, policy);
      const releasedUsd = nextState.rewards.reduce(
        (total, reward, index) =>
          total +
          (state.rewards[index]?.status !== "available" && reward.status === "available"
            ? reward.amountUsd
            : 0),
        0,
      );
      return {
        state: nextState,
        event: {
          sequence,
          day: nextState.day,
          action: action.type,
          clause: releasedUsd > 0 ? "return-window release" : "return-window timing",
          summary: `Advanced ${action.days} days.`,
          ledgerEffect:
            releasedUsd > 0
              ? `+${formatUsd(releasedUsd)} available referral credit`
              : "No credit released",
        },
      };
    }
  }
}

export function replayCommerce(
  initialState: CommerceState,
  actions: readonly CommerceAction[],
  inputPolicy: CommercePolicy,
): CommerceReplay {
  const policy = parseCommercePolicy(inputPolicy);
  let state = structuredClone(initialState);
  const events: CommerceEvent[] = [];
  actions.forEach((inputAction, index) => {
    const action = parseCommerceAction(inputAction);
    const result = stepCommerce(state, action, policy, index + 1);
    state = result.state;
    events.push(result.event);
  });
  return { state, events };
}
