import {
  canonicalHash,
  createBottleReturnState,
  type Action,
  type WorldState,
} from "../packages/engine/src/index.js";
import {
  calculateCommerceStrategyMetrics,
  commerceGoal,
  CommerceSimulationError,
  createCommerceState,
  createHonestCustomerActions,
  replayCommerce,
  verifyCommerceExploit,
  vulnerableCommercePolicy,
  type CommerceAction,
  type CommerceGoal,
  type CommercePolicy,
  type CommerceReplay,
  type CommerceState,
} from "../packages/commerce/src/index.js";
import {
  createHonestWorkerActions,
  hashReplay,
  replayActions,
} from "../packages/evaluation/src/index.js";
import type { Policy } from "../packages/policy/src/index.js";
import { verifyCandidate } from "../apps/server/src/runs/verifier.js";
import {
  batchBonusExploitActions,
  batchHonestSixActions,
  exploitActions,
  patchPolicies,
  startingPolicy,
} from "../apps/web/src/replay-data.js";

type ExpectedClassification = "flawed" | "blocked";
type Mechanism =
  | "repeated_deposits"
  | "ineligible_material"
  | "transient_batch_bonus"
  | "credit_retained_after_refund"
  | "credit_spent_before_reversal"
  | "promotional_credit_qualification";

interface FrozenCaseBase {
  readonly id: string;
  readonly mechanism: Mechanism;
  readonly expected: ExpectedClassification;
  readonly sourceText: string;
  readonly intendedOutcome: string;
  readonly protectedLegitimateBehavior: string;
}

export interface FrozenBottleCase extends FrozenCaseBase {
  readonly domain: "bottle_return";
  readonly initialState: WorldState;
  readonly policy: Policy;
  readonly referenceActions: readonly Action[];
  readonly honestActions: readonly Action[];
  readonly expectedHonestReward: number;
}

export interface FrozenCommerceCase extends FrozenCaseBase {
  readonly domain: "commerce";
  readonly initialState: CommerceState;
  readonly policy: CommercePolicy;
  readonly goal: CommerceGoal;
  readonly referenceActions: readonly CommerceAction[];
  readonly honestActions: readonly CommerceAction[];
  readonly expectedHonestReward: number;
}

export type FrozenEvaluationCase = FrozenBottleCase | FrozenCommerceCase;

const bottleInitialState = createBottleReturnState();
const bottleHonestActions = createHonestWorkerActions(bottleInitialState);
const processingAllMaterials: Policy = {
  schemaVersion: 1,
  clauses: [{
    id: "all-material-processing",
    enabled: true,
    trigger: "process",
    points: 10,
    eligibleOnly: false,
    materials: ["plastic", "aluminium", "carton", "rubbish"],
    repetition: "once_per_item",
  }],
};
const ineligibleProcessingActions: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "R1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "move", direction: "down" },
  { type: "move", direction: "down" },
  { type: "process", itemId: "R1" },
  { type: "finish" },
];

const reverseImmediately: CommercePolicy = {
  ...vulnerableCommercePolicy,
  name: "Reverse immediate referral credit",
  referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" },
};
const payAfterWindow: CommercePolicy = {
  ...vulnerableCommercePolicy,
  name: "Pay after return window",
  referral: {
    ...vulnerableCommercePolicy.referral,
    issuance: "after_return_window",
    refundHandling: "reverse",
  },
};
const spentBeforeReversalActions: readonly CommerceAction[] = [
  { type: "refer", referrerId: "A", customerId: "B" },
  { type: "purchase", accountId: "B", purchaseId: "P1", priceUsd: 20, promoCreditUsd: 0 },
  { type: "purchase", accountId: "A", purchaseId: "P2", priceUsd: 10, promoCreditUsd: 10 },
  { type: "refund", accountId: "B", purchaseId: "P1" },
];
const refundActions: readonly CommerceAction[] = [
  { type: "refer", referrerId: "A", customerId: "B" },
  { type: "purchase", accountId: "B", purchaseId: "P1", priceUsd: 20, promoCreditUsd: 0 },
  { type: "refund", accountId: "B", purchaseId: "P1" },
];
const promoQualificationFlaw: CommercePolicy = {
  ...vulnerableCommercePolicy,
  name: "Promotional credit qualifies",
  referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" },
};
const promoQualificationControl: CommercePolicy = {
  ...promoQualificationFlaw,
  name: "Cash qualifies after returns close",
  referral: {
    ...promoQualificationFlaw.referral,
    qualificationBasis: "cash_paid",
    issuance: "after_return_window",
    promoCreditCountsTowardThreshold: false,
  },
};
const promoInitialState: CommerceState = {
  ...createCommerceState(),
  accounts: createCommerceState().accounts.map((account) =>
    account.id === "B" ? { ...account, availableCreditUsd: 20 } : account,
  ),
};
const promoQualificationActions: readonly CommerceAction[] = [
  { type: "refer", referrerId: "A", customerId: "B" },
  { type: "purchase", accountId: "B", purchaseId: "P1", priceUsd: 20, promoCreditUsd: 20 },
];

function bottleCase(
  value: Omit<FrozenBottleCase, "domain" | "initialState">,
): FrozenBottleCase {
  return { ...value, domain: "bottle_return", initialState: bottleInitialState };
}

function commerceCase(
  value: Omit<FrozenCommerceCase, "domain">,
): FrozenCommerceCase {
  return { ...value, domain: "commerce" };
}

export const frozenEvaluationSuite = {
  version: "fine-print-eval-v4",
  designedBenchmark: true,
  cases: [
    bottleCase({
      id: "bottle-repeated-deposits-flawed",
      mechanism: "repeated_deposits",
      expected: "flawed",
      sourceText: "Pay 10 points every time an item is deposited.",
      intendedOutcome: "Reward useful processing once per eligible item, not repeated handling.",
      protectedLegitimateBehavior: "Six eligible items processed honestly still earn 60 points.",
      policy: startingPolicy,
      referenceActions: exploitActions,
      honestActions: bottleHonestActions,
      expectedHonestReward: 60,
    }),
    bottleCase({
      id: "bottle-repeated-deposits-control",
      mechanism: "repeated_deposits",
      expected: "blocked",
      sourceText: "Pay 10 points once, after an eligible item is processed.",
      intendedOutcome: "Reward useful processing once per eligible item, not repeated handling.",
      protectedLegitimateBehavior: "Six eligible items processed honestly still earn 60 points.",
      policy: patchPolicies.eligibleProcessing,
      referenceActions: exploitActions,
      honestActions: bottleHonestActions,
      expectedHonestReward: 60,
    }),
    bottleCase({
      id: "bottle-ineligible-material-flawed",
      mechanism: "ineligible_material",
      expected: "flawed",
      sourceText: "Pay 10 points after any material is processed.",
      intendedOutcome: "Only eligible plastic and aluminium processing should earn rewards.",
      protectedLegitimateBehavior: "Six eligible items processed honestly still earn 60 points.",
      policy: processingAllMaterials,
      referenceActions: ineligibleProcessingActions,
      honestActions: bottleHonestActions,
      expectedHonestReward: 60,
    }),
    bottleCase({
      id: "bottle-ineligible-material-control",
      mechanism: "ineligible_material",
      expected: "blocked",
      sourceText: "Pay 10 points once after eligible plastic or aluminium is processed.",
      intendedOutcome: "Only eligible plastic and aluminium processing should earn rewards.",
      protectedLegitimateBehavior: "Six eligible items processed honestly still earn 60 points.",
      policy: patchPolicies.eligibleProcessing,
      referenceActions: ineligibleProcessingActions,
      honestActions: bottleHonestActions,
      expectedHonestReward: 60,
    }),
    bottleCase({
      id: "bottle-transient-batch-flawed",
      mechanism: "transient_batch_bonus",
      expected: "flawed",
      sourceText: "Pay a five-point bonus whenever the hopper reaches three eligible items.",
      intendedOutcome: "Each batch bonus should correspond to three permanently processed eligible items.",
      protectedLegitimateBehavior: "Two honest three-item batches still earn 70 total points.",
      policy: patchPolicies.batchVulnerable,
      referenceActions: batchBonusExploitActions,
      honestActions: batchHonestSixActions,
      expectedHonestReward: 70,
    }),
    bottleCase({
      id: "bottle-transient-batch-control",
      mechanism: "transient_batch_bonus",
      expected: "blocked",
      sourceText: "Pay a five-point bonus for each third permanent eligible-processing receipt.",
      intendedOutcome: "Each batch bonus should correspond to three permanently processed eligible items.",
      protectedLegitimateBehavior: "Two honest three-item batches still earn 70 total points.",
      policy: patchPolicies.batchReceipt,
      referenceActions: batchBonusExploitActions,
      honestActions: batchHonestSixActions,
      expectedHonestReward: 70,
    }),
    commerceCase({
      id: "commerce-refund-retention-flawed",
      mechanism: "credit_retained_after_refund",
      expected: "flawed",
      sourceText: "Give the referrer and referred customer $10 each immediately after the customer makes a $20 gross purchase. Promotional credit counts toward the threshold. Returns are allowed for 30 days, and issued credit remains after a refund.",
      intendedOutcome: "Referral rewards require at least $20 of retained revenue.",
      protectedLegitimateBehavior: "A kept $20 cash purchase still earns $20 of referral reward.",
      initialState: createCommerceState(),
      policy: vulnerableCommercePolicy,
      goal: commerceGoal,
      referenceActions: refundActions,
      honestActions: createHonestCustomerActions(vulnerableCommercePolicy),
      expectedHonestReward: 20,
    }),
    commerceCase({
      id: "commerce-refund-retention-control",
      mechanism: "credit_retained_after_refund",
      expected: "blocked",
      sourceText: "Give the referrer and referred customer $10 each only after a $20 gross purchase survives the 30-day return window. Promotional credit counts toward the threshold, and refunding the purchase reverses its reward.",
      intendedOutcome: "Referral rewards require at least $20 of retained revenue.",
      protectedLegitimateBehavior: "A kept $20 cash purchase still earns $20 of referral reward.",
      initialState: createCommerceState(),
      policy: payAfterWindow,
      goal: commerceGoal,
      referenceActions: refundActions,
      honestActions: createHonestCustomerActions(payAfterWindow),
      expectedHonestReward: 20,
    }),
    commerceCase({
      id: "commerce-spent-reversal-flawed",
      mechanism: "credit_spent_before_reversal",
      expected: "flawed",
      sourceText: "Give the referrer and referred customer $10 each immediately after the customer makes a $20 gross purchase. Promotional credit counts toward the threshold. Returns are allowed for 30 days, and refunding the purchase reverses both credits.",
      intendedOutcome: "A refund should leave no spendable or unrecovered reward value.",
      protectedLegitimateBehavior: "A kept $20 cash purchase still earns $20 of referral reward immediately.",
      initialState: createCommerceState(),
      policy: reverseImmediately,
      goal: commerceGoal,
      referenceActions: spentBeforeReversalActions,
      honestActions: createHonestCustomerActions(reverseImmediately),
      expectedHonestReward: 20,
    }),
    commerceCase({
      id: "commerce-spent-reversal-control",
      mechanism: "credit_spent_before_reversal",
      expected: "blocked",
      sourceText: "Give the referrer and referred customer $10 each only after a $20 gross purchase survives the 30-day return window. Promotional credit counts toward the threshold, and refunding the purchase reverses its reward.",
      intendedOutcome: "A refund should leave no spendable or unrecovered reward value.",
      protectedLegitimateBehavior: "A kept $20 cash purchase still earns $20 of referral reward after 30 days.",
      initialState: createCommerceState(),
      policy: payAfterWindow,
      goal: commerceGoal,
      referenceActions: spentBeforeReversalActions,
      honestActions: createHonestCustomerActions(payAfterWindow),
      expectedHonestReward: 20,
    }),
    commerceCase({
      id: "commerce-promo-qualification-flawed",
      mechanism: "promotional_credit_qualification",
      expected: "flawed",
      sourceText: "Give the referrer and referred customer $10 each immediately after a $20 gross purchase. Promotional credit counts toward the threshold. Returns are allowed for 30 days, and refunding the purchase reverses its reward.",
      intendedOutcome: "The qualifying purchase should contribute at least $20 of retained cash revenue.",
      protectedLegitimateBehavior: "A $20 cash purchase still earns $20 of referral reward.",
      initialState: promoInitialState,
      policy: promoQualificationFlaw,
      goal: commerceGoal,
      referenceActions: promoQualificationActions,
      honestActions: createHonestCustomerActions(promoQualificationFlaw),
      expectedHonestReward: 20,
    }),
    commerceCase({
      id: "commerce-promo-qualification-control",
      mechanism: "promotional_credit_qualification",
      expected: "blocked",
      sourceText: "Give the referrer and referred customer $10 each after a $20 cash purchase survives the 30-day return window. Promotional credit does not count toward the threshold, and refunding the purchase reverses its reward.",
      intendedOutcome: "The qualifying purchase should contribute at least $20 of retained cash revenue.",
      protectedLegitimateBehavior: "A retained $20 cash purchase still earns $20 of referral reward after 30 days.",
      initialState: promoInitialState,
      policy: promoQualificationControl,
      goal: commerceGoal,
      referenceActions: promoQualificationActions,
      honestActions: createHonestCustomerActions(promoQualificationControl),
      expectedHonestReward: 20,
    }),
  ] as readonly FrozenEvaluationCase[],
} as const;

export const frozenSuiteHash = canonicalHash(frozenEvaluationSuite);

export const frozenModelInputs = frozenEvaluationSuite.cases.map((item) => ({
  id: item.id,
  domain: item.domain,
  sourceText: item.sourceText,
  intendedOutcome: item.intendedOutcome,
  protectedLegitimateBehavior: item.protectedLegitimateBehavior,
  policy: item.policy,
  initialState: item.initialState,
  ...(item.domain === "commerce" ? { goal: item.goal } : {}),
}));

export function evaluateFrozenCase(item: FrozenEvaluationCase) {
  if (item.domain === "bottle_return") {
    const reference = verifyCandidate(item.initialState, item.policy, item.referenceActions);
    const honest = replayActions(item.initialState, item.honestActions, item.policy);
    const referenceReplay = replayActions(item.initialState, item.referenceActions, item.policy);
    return {
      actualClassification:
        reference.status === "exploit_verified" ? "flawed" as const : "blocked" as const,
      protectedBehaviorPreserved:
        honest.state.rewardLedger.totalPoints === item.expectedHonestReward,
      deterministicReplayAgreement:
        hashReplay(referenceReplay) ===
        hashReplay(replayActions(item.initialState, item.referenceActions, item.policy)),
      referenceResult: reference,
      honestReward: honest.state.rewardLedger.totalPoints,
    };
  }
  const replayAcceptedPrefix = (): CommerceReplay => {
    let replay = replayCommerce(item.initialState, [], item.policy);
    for (let length = 1; length <= item.referenceActions.length; length += 1) {
      try {
        replay = replayCommerce(item.initialState, item.referenceActions.slice(0, length), item.policy);
      } catch (error) {
        if (!(error instanceof CommerceSimulationError)) throw error;
        break;
      }
    }
    return replay;
  };
  const referenceReplay = replayAcceptedPrefix();
  const verification = verifyCommerceExploit(referenceReplay, item.goal);
  const honestReplay = replayCommerce(item.initialState, item.honestActions, item.policy);
  const honest = calculateCommerceStrategyMetrics(honestReplay, item.goal);
  return {
    actualClassification:
      verification.status === "exploit_verified" ? "flawed" as const : "blocked" as const,
    protectedBehaviorPreserved:
      honest.availableRewardUsd === item.expectedHonestReward &&
      honest.retainedRevenueUsd >= item.goal.minimumUsd,
    deterministicReplayAgreement:
      JSON.stringify(referenceReplay) === JSON.stringify(replayAcceptedPrefix()),
    referenceResult: verification,
    honestReward: honest.availableRewardUsd,
  };
}

export const interpretationSuite = [
  {
    id: "commerce-explicit-refund",
    sourceText: "Pay both people $9 after a $35 purchase, keep credit after refunds, with a 21-day return window.",
    expectedDisposition: "map",
    expectedFields: { rewardUsd: 9, qualifyingPurchaseUsd: 35, refundHandling: "keep", returnWindowDays: 21 },
  },
  {
    id: "commerce-explicit-promo",
    sourceText: "Only cash paid counts toward a $40 referral threshold; pay $12 after 14 days.",
    expectedDisposition: "map",
    expectedFields: { rewardUsd: 12, qualifyingPurchaseUsd: 40, promoCreditCountsTowardThreshold: false, returnWindowDays: 14 },
  },
  {
    id: "bottle-explicit-processing",
    sourceText: "Pay seven points once per aluminium item after successful processing.",
    expectedDisposition: "map",
    expectedFields: { trigger: "process", points: 7, materials: ["aluminium"], repetition: "once_per_item" },
  },
  {
    id: "bottle-ambiguous-good-recycling",
    sourceText: "Reward good recycling fairly.",
    expectedDisposition: "clarify",
    expectedFields: {},
  },
  {
    id: "commerce-unsupported-geography",
    sourceText: "Pay only Canadian customers using a unique device fingerprint.",
    expectedDisposition: "unsupported",
    expectedFields: {},
  },
  {
    id: "bottle-unsupported-dynamic-market-price",
    sourceText: "Pay the live commodity-market value of each item.",
    expectedDisposition: "unsupported",
    expectedFields: {},
  },
] as const;
