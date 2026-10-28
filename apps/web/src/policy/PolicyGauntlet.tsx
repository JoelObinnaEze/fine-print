import { useMemo } from "react";

import type { Action } from "../../../../packages/engine/src/actions.js";
import { createBottleReturnState } from "../../../../packages/engine/src/scenario.js";
import { createHonestWorkerActions } from "../../../../packages/evaluation/src/honest-worker.js";
import { calculateCompletedMetrics } from "../../../../packages/evaluation/src/metrics.js";
import { replayActions } from "../../../../packages/evaluation/src/replay.js";
import type { Policy } from "../../../../packages/policy/src/index.js";
import { exploitActions } from "../replay-data.js";

const contaminationActions: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "R1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "move", direction: "down" },
  { type: "move", direction: "right" },
  { type: "process", itemId: "R1" },
  { type: "finish" },
];

const honestOrders = [
  { name: "Input order", itemIds: ["B1", "B2", "B3", "C1", "C2", "C3"] },
  { name: "Reverse order", itemIds: ["C3", "C2", "C1", "B3", "B2", "B1"] },
  { name: "Alternating order", itemIds: ["B1", "C1", "B2", "C2", "B3", "C3"] },
] as const;

const prematurePayoutActions: readonly Action[] = [
  ...exploitActions.slice(0, 7),
  { type: "finish" },
];

export interface GauntletResult {
  readonly honestWorkflows: {
    readonly passed: number;
    readonly total: number;
    readonly results: readonly {
      readonly name: string;
      readonly expectedReward: number;
      readonly actualReward: number;
      readonly passed: boolean;
    }[];
  };
  readonly attacks: readonly {
    readonly id: "duplicate_reward" | "ineligible_payout" | "premature_payout";
    readonly name: string;
    readonly blocked: boolean;
    readonly observedReward: number;
    readonly result: string;
  }[];
}

export function evaluatePolicyGauntlet(policy: Policy): GauntletResult {
  const initialState = createBottleReturnState();
  const expectedHonestReward = initialState.items.filter((item) => item.eligible).length * 10;
  const completedMetrics = (actions: readonly Action[]) =>
    calculateCompletedMetrics(initialState, replayActions(initialState, actions, policy));
  const honestResults = honestOrders.map(({ name, itemIds }) => {
    const metrics = completedMetrics(createHonestWorkerActions(initialState, itemIds));
    return {
      name,
      expectedReward: expectedHonestReward,
      actualReward: metrics.reward,
      passed: metrics.legitimateCoverage === 1,
    };
  });
  const duplicateReward = completedMetrics(exploitActions).reward;
  const ineligiblePayout = completedMetrics(contaminationActions).reward;
  const prematurePayout = completedMetrics(prematurePayoutActions).reward;
  return {
    honestWorkflows: {
      passed: honestResults.filter(({ passed }) => passed).length,
      total: honestResults.length,
      results: honestResults,
    },
    attacks: [
      {
        id: "duplicate_reward",
        name: "Repeated reward",
        blocked: duplicateReward <= 10,
        observedReward: duplicateReward,
        result: duplicateReward <= 10 ? "No duplicate payout" : `One item earned ${duplicateReward} points`,
      },
      {
        id: "ineligible_payout",
        name: "Ineligible material",
        blocked: ineligiblePayout === 0,
        observedReward: ineligiblePayout,
        result: ineligiblePayout === 0 ? "Paid nothing" : `Ineligible deposit paid ${ineligiblePayout} points`,
      },
      {
        id: "premature_payout",
        name: "Before completion",
        blocked: prematurePayout === 0,
        observedReward: prematurePayout,
        result: prematurePayout === 0 ? "Paid nothing" : `Pre-processing deposit paid ${prematurePayout} points`,
      },
    ],
  };
}

function EvidenceCard({ label, result }: { readonly label: string; readonly result: GauntletResult }) {
  const blocked = result.attacks.filter((attack) => attack.blocked).length;
  return (
    <article className="gauntlet__score-card">
      <p className="eyebrow">{label}</p>
      <output aria-label={`${label} honest workflows preserved`}>
        {result.honestWorkflows.passed} / {result.honestWorkflows.total}
      </output>
      <p>honest workflows preserved</p>
      <output aria-label={`${label} known failures blocked`}>
        {blocked} / {result.attacks.length}
      </output>
      <p>known failures blocked</p>
    </article>
  );
}

export function PolicyGauntlet({
  policy,
  patchedPolicy,
}: {
  readonly policy: Policy;
  readonly patchedPolicy: Policy | null;
}) {
  const active = useMemo(() => evaluatePolicyGauntlet(policy), [policy]);
  const patched = useMemo(
    () => patchedPolicy && evaluatePolicyGauntlet(patchedPolicy),
    [patchedPolicy],
  );
  const inspected = patched ?? active;
  const inspectedLabel = patched ? "Selected patch" : "Active policy";
  return (
    <section className="gauntlet" aria-labelledby="gauntlet-title">
      <div className="gauntlet__heading">
        <div>
          <p className="eyebrow">Regression evidence</p>
          <h2 id="gauntlet-title">Policy gauntlet</h2>
        </div>
        <p>Three honest orders plus three disclosed adversarial mechanisms.</p>
      </div>
      <div className="gauntlet__results">
        <EvidenceCard label="Active" result={active} />
        {patched && <EvidenceCard label="Selected patch" result={patched} />}
        <ul>
          {inspected.attacks.map((attack) => (
            <li className={attack.blocked ? "is-pass" : "is-fail"} key={attack.id}>
              <b>{attack.blocked ? "Blocked" : "Failed"}</b>
              <span><strong>{attack.name}</strong>{attack.result}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="gauntlet__honest">
        <div>
          <h3>Honest-work reference</h3>
          <p>
            Reference goal: process all six eligible items for 10 points each. A different policy
            is not invalid; it simply does not preserve this baseline.
          </p>
        </div>
        <ul aria-label={`${inspectedLabel} honest workflow payouts`}>
          {inspected.honestWorkflows.results.map((result) => (
            <li className={result.passed ? "is-pass" : "is-different"} key={result.name}>
              <b>{result.name}</b>
              <span>Expected {result.expectedReward} · actual {result.actualReward}</span>
              <em>{result.passed ? "Preserved" : "Different"}</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
