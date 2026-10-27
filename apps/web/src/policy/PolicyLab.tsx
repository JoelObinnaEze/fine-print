import type { ReplayFrame } from "../replay-data.js";
import type { Policy } from "../../../../packages/policy/src/index.js";

const labels = {
  trigger: "Trigger",
  points: "Points",
  eligibleOnly: "Eligibility required",
  materials: "Materials",
  repetition: "Repetition",
} as const;

type ComparableField = keyof typeof labels;

function display(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value).replaceAll("_", " ");
}

export function PolicyLab({
  originalPolicy,
  patchedPolicy,
  frame,
  patchedFrame,
  actionCount,
}: {
  readonly originalPolicy: Policy;
  readonly patchedPolicy: Policy | null;
  readonly frame: ReplayFrame;
  readonly patchedFrame: ReplayFrame | null;
  readonly actionCount: number;
}) {
  const originalClause = originalPolicy.clauses[0]!;
  const patchedClause = patchedPolicy?.clauses[0];
  const changedFields = patchedClause
    ? (Object.keys(labels) as ComparableField[]).filter(
        (field) => JSON.stringify(originalClause[field]) !== JSON.stringify(patchedClause[field]),
      )
    : [];

  return (
    <section className="policy-lab" aria-labelledby="policy-lab-title">
      <div className="policy-lab__heading">
        <div>
          <p className="eyebrow">Technical evidence</p>
          <h2 id="policy-lab-title">Policy Lab</h2>
        </div>
        <p>Observed traces, not a safety guarantee.</p>
      </div>

      <dl className="provenance-grid" aria-label="Run provenance and limits">
        <div><dt>Provenance</dt><dd>Scripted fixture</dd></div>
        <div><dt>Inference requests</dt><dd>0</dd></div>
        <div><dt>Tick limit</dt><dd>{frame.state.horizon}</dd></div>
        <div><dt>Submitted actions</dt><dd>{actionCount}</dd></div>
      </dl>

      <div className="policy-lab__comparison">
        <section aria-labelledby="diff-title">
          <h3 id="diff-title">Structured policy diff</h3>
          {!patchedClause ? (
            <p className="empty-receipt">Choose a patch to inspect exact field changes.</p>
          ) : changedFields.length === 0 ? (
            <p className="empty-receipt">The selected policy has no clause changes.</p>
          ) : (
            <table>
              <thead><tr><th>Field</th><th>Original</th><th>Patched</th></tr></thead>
              <tbody>
                {changedFields.map((field) => (
                  <tr key={field}>
                    <th scope="row">{labels[field]}</th>
                    <td>{display(originalClause[field])}</td>
                    <td>{display(patchedClause[field])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section aria-labelledby="receipt-audit-title">
          <h3 id="receipt-audit-title">Receipt audit at tick {frame.state.tick}</h3>
          <dl className="receipt-audit">
            <div><dt>Original payouts</dt><dd>{frame.payouts.length}</dd></div>
            <div><dt>Original paid</dt><dd>{frame.state.rewardLedger.totalPoints}</dd></div>
            <div><dt>Patched payouts</dt><dd>{patchedFrame?.payouts.length ?? "—"}</dd></div>
            <div><dt>Patched paid</dt><dd>{patchedFrame?.state.rewardLedger.totalPoints ?? "—"}</dd></div>
          </dl>
          <p className="portable-note">
            Server exports include the exact policy, actions, provenance, limits, and integrity hashes for offline replay.
          </p>
        </section>
      </div>
    </section>
  );
}
