import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
      unrecoveredRewardUsd: 0,
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

  it("counts reward value spent before reversal as unrecovered", () => {
    const reversiblePolicy = {
      ...vulnerableCommercePolicy,
      referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" as const },
    };
    const replay = replayCommerce(
      createCommerceState(),
      [
        { type: "refer", referrerId: "A", customerId: "B" },
        { type: "purchase", accountId: "B", purchaseId: "P1", priceUsd: 20, promoCreditUsd: 0 },
        { type: "purchase", accountId: "A", purchaseId: "P2", priceUsd: 10, promoCreditUsd: 10 },
        { type: "refund", accountId: "B", purchaseId: "P1" },
      ],
      reversiblePolicy,
    );

    expect(verifyCommerceExploit(replay, commerceGoal)).toEqual({
      status: "exploit_verified",
      availableRewardUsd: 0,
      unrecoveredRewardUsd: 10,
      retainedRevenueUsd: 0,
      unintendedPayoutUsd: 10,
      reason: "$10 of issued reward had already been spent and remained unrecovered while retained revenue was $0, below the $20 intended outcome.",
    });
  });

  it("keeps the corrected repair evidence reproducible", () => {
    const artifact = JSON.parse(
      readFileSync("artifacts/commerce-repair-reverified.json", "utf8"),
    ) as {
      readonly actions: Parameters<typeof replayCommerce>[1];
      readonly result: ReturnType<typeof verifyCommerceExploit>;
      readonly sourceArtifactSha256: string;
    };
    const reversiblePolicy = {
      ...vulnerableCommercePolicy,
      referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" as const },
    };

    expect(
      verifyCommerceExploit(
        replayCommerce(createCommerceState(), artifact.actions, reversiblePolicy),
        commerceGoal,
      ),
    ).toEqual(artifact.result);
    expect(
      createHash("sha256")
        .update(readFileSync("artifacts/commerce-repair-live.json"))
        .digest("hex"),
    ).toBe(artifact.sourceArtifactSha256);
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
