import type { Policy } from "../../../../packages/policy/src/index.js";
import type { PatchId } from "../replay-data.js";

function triggerLabel(clause: Policy["clauses"][number]): string {
  if (clause.trigger === "hopper_threshold") return `hopper reaches ${clause.batchSize}`;
  if (clause.trigger === "processed_batch") return `every ${clause.batchSize} processed receipts`;
  return clause.trigger;
}

export function PolicyCard({
  policy,
  activePatch,
  onTestPatch,
  sourceText,
}: {
  readonly policy: Policy;
  readonly activePatch: PatchId | null;
  readonly onTestPatch: (patch: PatchId) => void;
  readonly sourceText: string;
}) {
  const vulnerableBatch = policy.clauses.some((clause) => clause.trigger === "hopper_threshold");
  const prematureReward = policy.clauses.some((clause) => clause.trigger === "deposit");
  return (
    <section className="paper-card policy-card" aria-labelledby="policy-title">
      <p className="eyebrow">Active policy · v1</p>
      <h2 id="policy-title">The fine print</h2>
      <blockquote>{sourceText}</blockquote>
      {policy.clauses.length > 0 ? (
        policy.clauses.map((clause) => (
          <section className="policy-clause" key={clause.id}>
            <h3>{clause.id.replaceAll("-", " ")}</h3>
            <dl className="clause-grid">
              <div><dt>When</dt><dd>{triggerLabel(clause)}</dd></div>
              <div><dt>Which</dt><dd>{clause.eligibleOnly ? "eligible " : ""}{clause.materials.join(", ")} items</dd></div>
              <div><dt>How often</dt><dd>{clause.repetition.replaceAll("_", " ")}</dd></div>
              <div><dt>Completion required</dt><dd>{clause.trigger === "process" || clause.trigger === "processed_batch" ? "yes" : "no"}</dd></div>
              <div><dt>Points</dt><dd>+{clause.points}</dd></div>
            </dl>
          </section>
        ))
      ) : (
        <p className="empty-receipt">No reward clauses are active.</p>
      )}
      <p className="policy-warning">
        <span aria-hidden="true">!</span> {vulnerableBatch
          ? "The batch bonus trusts transient hopper contents rather than permanent processing receipts."
          : prematureReward
            ? "Depositing is rewarded before recycling is proven."
            : "Every active payout requires successful processing evidence."}
      </p>
      <details className="policy-json">
        <summary>Inspect structured policy</summary>
        <pre>{JSON.stringify(policy, null, 2)}</pre>
      </details>
      <div className="patch-actions" aria-label="Manual patch presets">
        <h3>Test a patch</h3>
        <button
          aria-pressed={activePatch === "oncePerItem"}
          type="button"
          onClick={() => onTestPatch("oncePerItem")}
        >
          Test once-per-item patch
        </button>
        <button
          aria-pressed={activePatch === "eligibleProcessing"}
          type="button"
          onClick={() => onTestPatch("eligibleProcessing")}
        >
          Test eligible-processing patch
        </button>
      </div>
    </section>
  );
}
