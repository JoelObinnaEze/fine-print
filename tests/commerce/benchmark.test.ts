import { describe, expect, it } from "vitest";

import {
  commerceGoal,
  commerceRepairCandidates,
  evaluateCommerceDesign,
  honestCustomerActions,
  minimizeCommerceExploit,
  refundAttackActions,
  verifyCommerceExploit,
  vulnerableCommercePolicy,
} from "../../packages/commerce/src/index.js";
import { createCommerceState, replayCommerce } from "../../packages/commerce/src/simulator.js";

describe("commerce referral/refund benchmark", () => {
  it("verifies the vulnerable multi-clause failure in dollars", () => {
    const replay = replayCommerce(
      createCommerceState(),
      refundAttackActions,
      vulnerableCommercePolicy,
    );
    const verification = verifyCommerceExploit(replay, commerceGoal);

    expect(verification).toEqual({
      status: "exploit_verified",
      availableRewardUsd: 20,
      retainedRevenueUsd: 0,
      unintendedPayoutUsd: 20,
      reason: "$20 became spendable while retained revenue was $0, below the $20 intended outcome.",
    });
    expect(replay.events.map((event) => event.clause)).toEqual([
      "referral relationship",
      "purchase qualification + credit issuance",
      "refund handling keeps issued credit",
    ]);
  });

  it("removes an unnecessary action but preserves every required counterexample step", () => {
    const noisyTrace = [
      refundAttackActions[0]!,
      refundAttackActions[1]!,
      { type: "advance_days", days: 1 } as const,
      refundAttackActions[2]!,
    ];
    const minimized = minimizeCommerceExploit(
      createCommerceState(),
      noisyTrace,
      vulnerableCommercePolicy,
      commerceGoal,
    );

    expect(minimized).toEqual(refundAttackActions);
    minimized.forEach((_action, index) => {
      const withoutOne = minimized.filter((_candidate, candidateIndex) => candidateIndex !== index);
      let status: "invalid" | "exploit_verified" | "no_exploit" = "invalid";
      try {
        const replay = replayCommerce(createCommerceState(), withoutOne, vulnerableCommercePolicy);
        status = verifyCommerceExploit(replay, commerceGoal).status;
      } catch {
        // Removing a required setup step may make the remaining transaction illegal.
      }
      expect(status).not.toBe("exploit_verified");
    });
  });

  it("tests all candidate repairs against the attack and honest customer", () => {
    const vulnerable = evaluateCommerceDesign(
      vulnerableCommercePolicy,
      commerceGoal,
      refundAttackActions,
      honestCustomerActions,
    );
    expect(vulnerable.attack).toEqual(
      expect.objectContaining({
        verifiedUnintendedPayoutUsd: 20,
        retainedRevenueUsd: 0,
      }),
    );
    expect(vulnerable.honest).toEqual(
      expect.objectContaining({
        availableRewardUsd: 20,
        retainedRevenueUsd: 20,
        rewardDelayDays: 0,
      }),
    );

    for (const candidate of commerceRepairCandidates) {
      const result = evaluateCommerceDesign(
        candidate.policy,
        commerceGoal,
        refundAttackActions,
        honestCustomerActions,
      );
      expect(result.attack.verifiedUnintendedPayoutUsd, candidate.id).toBe(0);
      expect(result.attack.retainedRevenueUsd, candidate.id).toBe(0);
      expect(result.honest.availableRewardUsd, candidate.id).toBe(20);
      expect(result.honest.retainedRevenueUsd, candidate.id).toBe(20);
      expect(result.honest.rewardDelayDays, candidate.id).toBe(30);
      expect(result.honestRewardsPreserved, candidate.id).toBe(true);
      expect(result.knownAttackBlocked, candidate.id).toBe(true);
    }
  });

  it("scores the accepted attack prefix when a repair rejects a later action", () => {
    const invalidTail = [
      ...refundAttackActions,
      {
        type: "purchase",
        accountId: "B",
        purchaseId: "P2",
        priceUsd: 20,
        promoCreditUsd: 20,
      } as const,
    ];

    const vulnerable = evaluateCommerceDesign(
      vulnerableCommercePolicy,
      commerceGoal,
      invalidTail,
      honestCustomerActions,
    );
    const repaired = evaluateCommerceDesign(
      commerceRepairCandidates[1]!.policy,
      commerceGoal,
      invalidTail,
      honestCustomerActions,
    );

    expect(vulnerable.attack.verifiedUnintendedPayoutUsd).toBe(20);
    expect(repaired.attack.verifiedUnintendedPayoutUsd).toBe(0);
    expect(repaired.knownAttackBlocked).toBe(true);
  });
});
