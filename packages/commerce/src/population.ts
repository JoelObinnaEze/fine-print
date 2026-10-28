import type { CommerceAction, CommerceGoal, CommercePolicy } from "./contracts.js";
import { calculateCommerceStrategyMetrics, type CommerceStrategyMetrics } from "./benchmark.js";
import { createCommerceState, replayCommerce, type CommerceState } from "./simulator.js";

export interface CommerceParticipantStrategy {
  readonly id: "ordinary" | "bargain_hunter" | "coordinated_adversary";
  readonly label: string;
  readonly objective: string;
  readonly participants: number;
  readonly assumptions: readonly string[];
  readonly accountIds: readonly string[];
  readonly actions: readonly CommerceAction[];
}

export interface CommercePopulationStrategyResult extends CommerceParticipantStrategy {
  readonly metrics: CommerceStrategyMetrics;
  readonly finalState: CommerceState;
}

export interface CommercePopulationResult {
  readonly assumption: string;
  readonly strategies: readonly CommercePopulationStrategyResult[];
  readonly aggregate: {
    readonly participants: number;
    readonly legitimateRewardUsd: number;
    readonly verifiedUnintendedPayoutUsd: number;
    readonly retainedRevenueUsd: number;
    readonly maximumRewardDelayDays: number;
  };
}

const participantStrategies: readonly CommerceParticipantStrategy[] = [
  {
    id: "ordinary",
    label: "Ordinary customers",
    objective: "Complete a wanted purchase and keep it after the return window.",
    participants: 2,
    assumptions: ["One genuine referral", "$20 wanted purchase", "No refund"],
    accountIds: ["O1", "O2"],
    actions: [
      { type: "refer", referrerId: "O1", customerId: "O2" },
      {
        type: "purchase",
        accountId: "O2",
        purchaseId: "OP1",
        priceUsd: 20,
        promoCreditUsd: 0,
      },
      { type: "advance_days", days: 30 },
    ],
  },
  {
    id: "bargain_hunter",
    label: "Bargain hunters",
    objective: "Use earned promotional credit while still buying and keeping wanted goods.",
    participants: 2,
    assumptions: ["One genuine referral", "Two kept purchases", "$10 credit funds part of purchase two"],
    accountIds: ["H1", "H2"],
    actions: [
      { type: "refer", referrerId: "H1", customerId: "H2" },
      {
        type: "purchase",
        accountId: "H2",
        purchaseId: "HP1",
        priceUsd: 20,
        promoCreditUsd: 0,
      },
      { type: "advance_days", days: 30 },
      {
        type: "purchase",
        accountId: "H2",
        purchaseId: "HP2",
        priceUsd: 20,
        promoCreditUsd: 10,
      },
    ],
  },
  {
    id: "coordinated_adversary",
    label: "Coordinated adversaries",
    objective: "Maximize spendable promotional credit while minimizing retained spending.",
    participants: 2,
    assumptions: ["Two coordinated accounts", "Full refund inside 30 days", "No identity bypass"],
    accountIds: ["A1", "A2"],
    actions: [
      { type: "refer", referrerId: "A1", customerId: "A2" },
      {
        type: "purchase",
        accountId: "A2",
        purchaseId: "AP1",
        priceUsd: 20,
        promoCreditUsd: 0,
      },
      { type: "refund", accountId: "A2", purchaseId: "AP1" },
    ],
  },
];

export function evaluateCommercePopulation(
  policy: CommercePolicy,
  goal: CommerceGoal,
): CommercePopulationResult {
  const strategies = participantStrategies.map(
    (strategy): CommercePopulationStrategyResult => {
      const replay = replayCommerce(
        createCommerceState(strategy.accountIds),
        strategy.actions,
        policy,
      );
      return {
        ...strategy,
        metrics: calculateCommerceStrategyMetrics(replay, goal),
        finalState: replay.state,
      };
    },
  );
  return {
    assumption:
      "Simulation under stated assumptions; these deterministic traces are not forecasts of real fraud rates.",
    strategies,
    aggregate: {
      participants: strategies.reduce((total, strategy) => total + strategy.participants, 0),
      legitimateRewardUsd: strategies.reduce(
        (total, strategy) =>
          total +
          (strategy.metrics.verifiedUnintendedPayoutUsd === 0
            ? strategy.metrics.availableRewardUsd
            : 0),
        0,
      ),
      verifiedUnintendedPayoutUsd: strategies.reduce(
        (total, strategy) => total + strategy.metrics.verifiedUnintendedPayoutUsd,
        0,
      ),
      retainedRevenueUsd: strategies.reduce(
        (total, strategy) => total + strategy.metrics.retainedRevenueUsd,
        0,
      ),
      maximumRewardDelayDays: Math.max(
        0,
        ...strategies.map((strategy) => strategy.metrics.rewardDelayDays ?? 0),
      ),
    },
  };
}
