import type { Policy } from "../../../../packages/policy/src/index.js";

export function PolicyCard({ policy }: { readonly policy: Policy }) {
  const clause = policy.clauses[0]!;
  return (
    <section className="paper-card policy-card" aria-labelledby="policy-title">
      <p className="eyebrow">Active policy · v1</p>
      <h2 id="policy-title">The fine print</h2>
      <blockquote>Pay 10 points whenever an item is deposited.</blockquote>
      <dl className="clause-grid">
        <div><dt>When</dt><dd>{clause.trigger}</dd></div>
        <div><dt>Which</dt><dd>any item</dd></div>
        <div><dt>How often</dt><dd>every event</dd></div>
        <div><dt>Points</dt><dd>+{clause.points}</dd></div>
      </dl>
      <p className="policy-warning">
        <span aria-hidden="true">!</span> Depositing is rewarded before recycling is proven.
      </p>
    </section>
  );
}
