import type { Policy } from "../../../../packages/policy/src/index.js";
import type { PatchId } from "../replay-data.js";

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
  const clause = policy.clauses[0];
  return (
    <section className="paper-card policy-card" aria-labelledby="policy-title">
      <p className="eyebrow">Active policy · v1</p>
      <h2 id="policy-title">The fine print</h2>
      <blockquote>{sourceText}</blockquote>
      {clause ? (
        <dl className="clause-grid">
          <div><dt>When</dt><dd>{clause.trigger}</dd></div>
          <div><dt>Which</dt><dd>{clause.eligibleOnly ? "eligible " : ""}{clause.materials.join(", ")} items</dd></div>
          <div><dt>How often</dt><dd>{clause.repetition.replaceAll("_", " ")}</dd></div>
          <div><dt>Completion required</dt><dd>{clause.trigger === "process" ? "yes" : "no"}</dd></div>
          <div><dt>Points</dt><dd>+{clause.points}</dd></div>
        </dl>
      ) : (
        <p className="empty-receipt">No reward clauses are active.</p>
      )}
      <p className="policy-warning">
        <span aria-hidden="true">!</span> {clause?.trigger === "deposit"
          ? "Depositing is rewarded before recycling is proven."
          : "This policy only pays after processing is observed."}
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
