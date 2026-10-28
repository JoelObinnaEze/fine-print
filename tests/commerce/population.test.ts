import { describe, expect, it } from "vitest";

import {
  commerceGoal,
  commerceRepairCandidates,
  evaluateCommercePopulation,
  vulnerableCommercePolicy,
} from "../../packages/commerce/src/index.js";

describe("commerce participant population", () => {
  it("keeps ordinary, bargain, and coordinated outcomes independently inspectable", () => {
    const result = evaluateCommercePopulation(vulnerableCommercePolicy, commerceGoal);

    expect(result.assumption).toMatch(/simulation under stated assumptions/i);
    expect(result.strategies.map((strategy) => strategy.id)).toEqual([
      "ordinary",
      "bargain_hunter",
      "coordinated_adversary",
    ]);
    expect(result.strategies.map((strategy) => strategy.participants)).toEqual([2, 2, 2]);

    const ordinary = result.strategies[0]!;
    expect(ordinary.metrics).toEqual(
      expect.objectContaining({
        availableRewardUsd: 20,
        verifiedUnintendedPayoutUsd: 0,
        retainedRevenueUsd: 20,
        rewardDelayDays: 0,
      }),
    );

    const bargain = result.strategies[1]!;
    expect(bargain.metrics).toEqual(
      expect.objectContaining({
        availableRewardUsd: 20,
        verifiedUnintendedPayoutUsd: 0,
        retainedRevenueUsd: 30,
      }),
    );
    expect(bargain.finalState.purchases).toEqual([
      expect.objectContaining({ id: "HP1", promoCreditUsd: 0, cashPaidUsd: 20 }),
      expect.objectContaining({ id: "HP2", promoCreditUsd: 10, cashPaidUsd: 10 }),
    ]);

    const adversary = result.strategies[2]!;
    expect(adversary.metrics).toEqual(
      expect.objectContaining({
        availableRewardUsd: 20,
        verifiedUnintendedPayoutUsd: 20,
        retainedRevenueUsd: 0,
      }),
    );
    expect(result.aggregate).toEqual(
      expect.objectContaining({
        participants: 6,
        legitimateRewardUsd: 40,
        verifiedUnintendedPayoutUsd: 20,
        retainedRevenueUsd: 50,
      }),
    );
  });

  it("shows how every repair changes population behavior without losing honest rewards", () => {
    for (const candidate of commerceRepairCandidates) {
      const result = evaluateCommercePopulation(candidate.policy, commerceGoal);
      expect(result.aggregate.verifiedUnintendedPayoutUsd, candidate.id).toBe(0);
      expect(result.aggregate.legitimateRewardUsd, candidate.id).toBe(40);
      expect(result.aggregate.retainedRevenueUsd, candidate.id).toBe(50);
      expect(result.aggregate.maximumRewardDelayDays, candidate.id).toBe(30);
    }
  });

  it("is deterministic across repeated population runs", () => {
    expect(evaluateCommercePopulation(vulnerableCommercePolicy, commerceGoal)).toEqual(
      evaluateCommercePopulation(vulnerableCommercePolicy, commerceGoal),
    );
  });
});
