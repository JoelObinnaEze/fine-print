import { describe, expect, it } from "vitest";

import {
  createCommerceState,
  parseCommerceAction,
  parseCommercePolicy,
  replayCommerce,
  type CommerceAction,
  type CommercePolicy,
} from "../../packages/commerce/src/index.js";

const vulnerablePolicy: CommercePolicy = {
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

const refundTrace: readonly CommerceAction[] = [
  { type: "refer", referrerId: "A", customerId: "B" },
  {
    type: "purchase",
    accountId: "B",
    purchaseId: "P1",
    priceUsd: 20,
    promoCreditUsd: 0,
  },
  { type: "refund", accountId: "B", purchaseId: "P1" },
];

describe("commerce contracts", () => {
  it("validates the bounded commerce policy and action language", () => {
    expect(parseCommercePolicy(vulnerablePolicy)).toEqual(vulnerablePolicy);
    expect(parseCommerceAction(refundTrace[1])).toEqual(refundTrace[1]);

    expect(() =>
      parseCommercePolicy({
        ...vulnerablePolicy,
        referral: { ...vulnerablePolicy.referral, rewardUsd: -1 },
      }),
    ).toThrow();
    expect(() =>
      parseCommerceAction({
        type: "purchase",
        accountId: "B",
        purchaseId: "P1",
        priceUsd: 20,
        promoCreditUsd: 21,
      }),
    ).toThrow();
    expect(() => parseCommerceAction({ type: "invent_money", amountUsd: 100 })).toThrow();
  });
});

describe("commerce replay", () => {
  it("verifies referral credit that survives a qualifying purchase refund", () => {
    const replay = replayCommerce(createCommerceState(), refundTrace, vulnerablePolicy);

    expect(replay.state.day).toBe(0);
    expect(replay.state.retainedRevenueUsd).toBe(0);
    expect(replay.state.purchases).toEqual([
      expect.objectContaining({
        id: "P1",
        accountId: "B",
        cashPaidUsd: 20,
        status: "refunded",
      }),
    ]);
    expect(replay.state.rewards).toEqual([
      expect.objectContaining({ accountId: "A", amountUsd: 10, status: "available" }),
      expect.objectContaining({ accountId: "B", amountUsd: 10, status: "available" }),
    ]);
    expect(replay.state.accounts.map((account) => [account.id, account.availableCreditUsd])).toEqual([
      ["A", 10],
      ["B", 10],
    ]);
    expect(replay.events.map((event) => event.clause)).toEqual([
      "referral relationship",
      "purchase qualification + credit issuance",
      "refund handling keeps issued credit",
    ]);
  });

  it("rejects illegal relationships, duplicate identities, and unavailable credit", () => {
    expect(() =>
      replayCommerce(
        createCommerceState(),
        [{ type: "refer", referrerId: "A", customerId: "A" }],
        vulnerablePolicy,
      ),
    ).toThrow("An account cannot refer itself");

    expect(() =>
      replayCommerce(
        createCommerceState(),
        [refundTrace[0]!, refundTrace[0]!],
        vulnerablePolicy,
      ),
    ).toThrow("Customer already has a referrer");

    expect(() =>
      replayCommerce(
        createCommerceState(),
        [
          refundTrace[0]!,
          refundTrace[1]!,
          {
            type: "purchase",
            accountId: "A",
            purchaseId: "P1",
            priceUsd: 20,
            promoCreditUsd: 0,
          },
        ],
        vulnerablePolicy,
      ),
    ).toThrow("Purchase ID already exists");

    expect(() =>
      replayCommerce(
        createCommerceState(),
        [
          {
            type: "purchase",
            accountId: "B",
            purchaseId: "P2",
            priceUsd: 20,
            promoCreditUsd: 10,
          },
        ],
        vulnerablePolicy,
      ),
    ).toThrow("Account does not have enough promotional credit");
  });

  it("releases pending rewards only after the return window", () => {
    const pendingPolicy: CommercePolicy = {
      ...vulnerablePolicy,
      referral: {
        ...vulnerablePolicy.referral,
        issuance: "pending",
        refundHandling: "reverse",
      },
    };
    const actions: readonly CommerceAction[] = [
      refundTrace[0]!,
      refundTrace[1]!,
      { type: "advance_days", days: 30 },
    ];
    const replay = replayCommerce(createCommerceState(), actions, pendingPolicy);

    expect(replay.state.retainedRevenueUsd).toBe(20);
    expect(replay.state.rewards.every((reward) => reward.status === "available")).toBe(true);
    expect(replay.state.accounts.map((account) => account.availableCreditUsd)).toEqual([10, 10]);
    expect(replay.events.at(-1)).toEqual(
      expect.objectContaining({
        clause: "return-window release",
        ledgerEffect: "+$20 available referral credit",
      }),
    );
  });
});
