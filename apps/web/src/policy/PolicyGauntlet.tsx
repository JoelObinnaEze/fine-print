import { useMemo } from "react";

import type { Action } from "../../../../packages/engine/src/actions.js";
import { createBottleReturnState } from "../../../../packages/engine/src/scenario.js";
import { createHonestWorkerActions } from "../../../../packages/evaluation/src/honest-worker.js";
import {
  calculateCompletedMetrics,
  calculateTestedPolicyScore,
} from "../../../../packages/evaluation/src/metrics.js";
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

interface GauntletResult {
  readonly score: number;
  readonly coverage: number;
  readonly attacks: readonly { readonly name: string; readonly leakedPoints: number }[];
}

function evaluate(policy: Policy): GauntletResult {
  const initialState = createBottleReturnState();
  const completedMetrics = (actions: readonly Action[]) =>
    calculateCompletedMetrics(initialState, replayActions(initialState, actions, policy));
  const honest = completedMetrics(createHonestWorkerActions(initialState));
  const attacks = [
    { name: "Repeat-deposit", metrics: completedMetrics(exploitActions) },
    { name: "Contamination", metrics: completedMetrics(contaminationActions) },
  ];
  const maximumLeakage = Math.max(...attacks.map(({ metrics }) => metrics.leakage));
  return {
    score: calculateTestedPolicyScore(honest.legitimateCoverage, maximumLeakage),
    coverage: honest.legitimateCoverage,
    attacks: attacks.map(({ name, metrics }) => ({ name, leakedPoints: metrics.excessReward })),
  };
}

function ScoreCard({ label, result }: { readonly label: string; readonly result: GauntletResult }) {
  const blocked = result.attacks.filter((attack) => attack.leakedPoints === 0).length;
  return (
    <article className="gauntlet__score-card">
      <p className="eyebrow">{label}</p>
      <output aria-label={`${label} tested-policy score`}>{result.score}</output>
      <span>/ 100 tested-policy score</span>
      <p>{Math.round(result.coverage * 100)}% honest-work coverage</p>
      <p>{blocked} / {result.attacks.length} adversarial attacks blocked</p>
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
  const active = useMemo(() => evaluate(policy), [policy]);
  const patched = useMemo(() => patchedPolicy && evaluate(patchedPolicy), [patchedPolicy]);
  return (
    <section className="gauntlet" aria-labelledby="gauntlet-title">
      <div className="gauntlet__heading">
        <div>
          <p className="eyebrow">Regression evidence</p>
          <h2 id="gauntlet-title">Policy gauntlet</h2>
        </div>
        <p>One honest workflow plus two deterministic adversarial traces.</p>
      </div>
      <div className="gauntlet__results">
        <ScoreCard label="Active" result={active} />
        {patched && <ScoreCard label="Patched" result={patched} />}
        <ul>
          {active.attacks.map((attack) => (
            <li className={attack.leakedPoints === 0 ? "is-pass" : "is-fail"} key={attack.name}>
              <b>{attack.leakedPoints === 0 ? "Blocked" : "Failed"}</b>
              <span>{attack.name} attack {attack.leakedPoints === 0 ? "paid nothing" : `leaked ${attack.leakedPoints} points`}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
