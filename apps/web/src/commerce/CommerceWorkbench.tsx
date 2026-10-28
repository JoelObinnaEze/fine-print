import { useEffect, useMemo, useState } from "react";

import {
  commercePolicyText,
  commerceRestrictions,
  commerceSourceText,
  createCommerceGoal,
  rankCommerceCandidates,
  recordedCommerceInvestigation,
  type CommerceInvestigationView,
  type CommercePriority,
} from "./recorded-investigation.js";

const priorityLabels: Readonly<Record<CommercePriority, string>> = {
  low_leakage: "lowest leakage",
  fast_rewards: "fast rewards",
  simple_operations: "simple operations",
  least_disruption: "least disruption",
};

function dollars(value: number): string {
  return `$${value}`;
}

type CommerceView = "policy" | "exploit" | "population" | "repairs";

const commerceViews: readonly {
  readonly id: CommerceView;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: "policy", label: "Policy", description: "Rules and intent" },
  { id: "exploit", label: "Exploit", description: "Verified failure" },
  { id: "population", label: "Audience", description: "Who optimizes what" },
  { id: "repairs", label: "Repairs", description: "Choose a tradeoff" },
];

export function CommerceWorkbench() {
  const [sourceText, setSourceText] = useState(commerceSourceText);
  const [minimumRevenue, setMinimumRevenue] = useState("20");
  const [restrictions, setRestrictions] = useState(commerceRestrictions);
  const [connection, setConnection] = useState<"checking" | "ready" | "offline">("checking");
  const [availableBudget, setAvailableBudget] = useState<number | null>(null);
  const [investigation, setInvestigation] = useState<CommerceInvestigationView>(
    recordedCommerceInvestigation,
  );
  const [priority, setPriority] = useState<CommercePriority>("low_leakage");
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [freshTest, setFreshTest] = useState<{
    readonly label: string;
    readonly leakage: number;
    readonly honestReward: number;
    readonly delay: number | null;
    readonly provenance: "host" | "live";
  } | null>(null);
  const [activeView, setActiveView] = useState<CommerceView>("exploit");

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/health"), fetch("/api/usage")])
      .then(async ([healthResponse, usageResponse]) => {
        if (!healthResponse.ok || !usageResponse.ok) throw new Error("Server unavailable");
        const health = (await healthResponse.json()) as {
          readonly liveAgent?: { readonly isEnabled?: boolean };
        };
        const usage = (await usageResponse.json()) as { readonly availableAppUsd?: number };
        if (!active) return;
        setConnection(health.liveAgent?.isEnabled ? "ready" : "offline");
        setAvailableBudget(
          typeof usage.availableAppUsd === "number" ? usage.availableAppUsd : null,
        );
      })
      .catch(() => active && setConnection("offline"));
    return () => {
      active = false;
    };
  }, []);

  const rankedCandidates = useMemo(
    () => rankCommerceCandidates(investigation.candidates, priority),
    [investigation.candidates, priority],
  );
  const recommended = rankedCandidates[0] ?? null;

  const requestInvestigation = async (
    text: string,
    mode: "primary" | "fresh",
    freshLabel?: string,
  ) => {
    const minimumUsd = Number(minimumRevenue);
    if (!Number.isInteger(minimumUsd) || minimumUsd < 1 || minimumUsd > 10_000) {
      setMessage("Minimum retained revenue must be a whole-dollar amount from 1 to 10000.");
      return;
    }
    setIsRunning(true);
    setMessage(mode === "primary" ? "Muse is mapping and attacking the programme…" : "Muse is fresh-attacking the selected design…");
    try {
      const response = await fetch("/api/commerce/investigations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `commerce-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          sourceText: text.trim(),
          goal: createCommerceGoal(minimumUsd),
          restrictions: restrictions
            .split("\n")
            .map((restriction) => restriction.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as CommerceInvestigationView & {
        readonly error?: { readonly message?: string };
      };
      if (!response.ok || !payload.mapping) {
        throw new Error(payload.error?.message ?? "Commerce investigation failed.");
      }
      const liveResult = { ...payload, provenance: "live" as const };
      if (mode === "primary") {
        setInvestigation(liveResult);
        setFreshTest(null);
        setActiveView(liveResult.attack ? "exploit" : "policy");
      } else {
        const ordinaryResult = liveResult.population?.strategies.find(
          (strategy) => strategy.id === "ordinary",
        );
        setFreshTest({
          label: freshLabel ?? "Selected design",
          leakage: liveResult.attack?.verification.unintendedPayoutUsd ?? 0,
          honestReward: ordinaryResult?.metrics.availableRewardUsd ?? 0,
          delay: ordinaryResult?.metrics.rewardDelayDays ?? null,
          provenance: "live",
        });
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commerce investigation failed.");
    } finally {
      try {
        const usageResponse = await fetch("/api/usage");
        if (usageResponse.ok) {
          const usage = (await usageResponse.json()) as { readonly availableAppUsd?: number };
          if (typeof usage.availableAppUsd === "number") setAvailableBudget(usage.availableAppUsd);
        }
      } catch {
        // Keep the last known budget when the local usage endpoint is unavailable.
      }
      setIsRunning(false);
    }
  };

  return (
    <section className="commerce" id="commerce" aria-labelledby="commerce-title">
      <header className="commerce__hero">
        <div className="commerce__hero-copy">
          <h2 id="commerce-title">Find where rewards detach from value.</h2>
          <p>Muse proposes the attack. Fine Print replays the ledger, minimizes the failure, and tests repairs without hiding the customer cost.</p>
          <div className="commerce__hero-actions">
            <button type="button" onClick={() => setActiveView("policy")}>Test your policy</button>
            <button type="button" onClick={() => setActiveView("repairs")}>Compare fixes</button>
          </div>
        </div>
        <dl className="commerce__headline-metrics">
          <div><dt>Unintended credit</dt><dd>{dollars(investigation.attack?.verification.unintendedPayoutUsd ?? 0)}</dd></div>
          <div><dt>Value retained</dt><dd>{dollars(investigation.attack?.verification.retainedRevenueUsd ?? 0)}</dd></div>
          <div><dt>Shortest exploit</dt><dd>{investigation.attack?.minimizedActions.length ?? 0}<small> steps</small></dd></div>
        </dl>
      </header>

      <nav className="commerce__steps" aria-label="Commerce investigation" role="tablist">
        {commerceViews.map((view) => (
          <button
            aria-controls={`commerce-panel-${view.id}`}
            aria-selected={activeView === view.id}
            id={`commerce-tab-${view.id}`}
            key={view.id}
            onClick={() => setActiveView(view.id)}
            role="tab"
            type="button"
          >
            <b>{view.label}</b>
            <span>{view.description}</span>
          </button>
        ))}
      </nav>

      <div
        aria-labelledby={`commerce-tab-${activeView}`}
        className="commerce__view"
        id={`commerce-panel-${activeView}`}
        role="tabpanel"
      >
        {activeView === "policy" && (
          <div className="commerce__policy-workspace">
            <section className="commerce__input" aria-labelledby="commerce-input-title">
              <div className="commerce__section-heading">
                <h3 id="commerce-input-title">Write the programme and the outcome separately</h3>
                <p className={`commerce__connection commerce__connection--${connection}`} role="status">
                  {connection === "ready"
                    ? `Live ready${availableBudget === null ? "" : ` · $${availableBudget.toFixed(2)} left`}`
                    : connection === "checking" ? "Checking connection" : "Recorded mode"}
                </p>
              </div>
              <div className="commerce__form-grid">
                <label className="commerce__policy-field">
                  <span>Actual reward rule</span>
                  <textarea rows={5} maxLength={4_000} value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
                </label>
                <label htmlFor="commerce-minimum-revenue">
                  <span>Value that must remain</span>
                  <span className="commerce__money-input"><b aria-hidden="true">$</b><input aria-label="Minimum retained revenue" id="commerce-minimum-revenue" min="1" max="10000" step="1" type="number" value={minimumRevenue} onChange={(event) => setMinimumRevenue(event.target.value)} /></span>
                </label>
                <label>
                  <span>Customer promise to preserve</span>
                  <textarea rows={3} maxLength={3_000} value={restrictions} onChange={(event) => setRestrictions(event.target.value)} />
                </label>
              </div>
              <div className="commerce__actions">
                <button type="button" disabled={connection !== "ready" || isRunning || sourceText.trim().length === 0} onClick={() => void requestInvestigation(sourceText, "primary")}>
                  {isRunning ? "Investigating…" : "Investigate with Muse"}
                </button>
                <button type="button" onClick={() => { setInvestigation(recordedCommerceInvestigation); setMessage(null); setFreshTest(null); setActiveView("exploit"); }}>
                  Load verified example
                </button>
                {message && <p aria-live="polite">{message}</p>}
              </div>
            </section>

            <section className="commerce__mapping" aria-labelledby="mapping-title">
              <div className="commerce__section-heading">
                <h3 id="mapping-title">What the simulator can enforce</h3>
                <strong>{investigation.mapping.status === "candidate" ? "Ready to replay" : "Needs wider support"}</strong>
              </div>
              <p>{investigation.mapping.reason}</p>
              <div className="commerce__mapping-lists">
                <div><b>Represented</b><ul>{investigation.mapping.supportedClauses.map((clause) => <li key={clause}>{clause}</li>)}</ul></div>
                <div><b>Unsupported</b>{investigation.mapping.unsupportedConditions.length === 0 ? <p>Nothing material.</p> : <ul>{investigation.mapping.unsupportedConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>}</div>
              </div>
              {investigation.mapping.policy && (
                <dl className="commerce__policy-map">
                  <div><dt>Reward</dt><dd>{dollars(investigation.mapping.policy.referral.rewardUsd)} each</dd></div>
                  <div><dt>Threshold</dt><dd>{dollars(investigation.mapping.policy.referral.qualifyingPurchaseUsd)}</dd></div>
                  <div><dt>Basis</dt><dd>{investigation.mapping.policy.referral.qualificationBasis.replaceAll("_", " ")}</dd></div>
                  <div><dt>Issuance</dt><dd>{investigation.mapping.policy.referral.issuance.replaceAll("_", " ")}</dd></div>
                  <div><dt>Refund</dt><dd>{investigation.mapping.policy.referral.refundHandling}</dd></div>
                  <div><dt>Window</dt><dd>{investigation.mapping.policy.referral.returnWindowDays} days</dd></div>
                </dl>
              )}
            </section>
          </div>
        )}

        {activeView === "exploit" && (investigation.attack ? (
          <section className="commerce__counterexample" aria-label="Verified counterexample">
            <div className="commerce__counterexample-intro">
              <div className="commerce__verdict-row"><span>Host verified</span><strong>{investigation.attack.proposedActionCount} proposed → {investigation.attack.minimizedActions.length} required</strong></div>
              <h3>{investigation.attack.verification.status === "exploit_verified" ? "The reward survives after the value disappears." : "The proposed exploit did not verify."}</h3>
              <p><b>Model hypothesis · unverified wording</b>{investigation.attack.hypothesis}</p>
              <p><b>Host verdict</b>{investigation.attack.verification.reason}</p>
            </div>
            <ol className="commerce__trace">
              {investigation.attack.events.map((event) => (
                <li key={event.sequence}><span>{String(event.sequence).padStart(2, "0")}</span><div><b>{event.summary}</b><small>{event.clause}</small><p>{event.ledgerEffect}</p></div></li>
              ))}
            </ol>
          </section>
        ) : (
          <div className="commerce__empty"><h3>No verified exploit yet</h3><p>Start with a policy and a measurable intended outcome.</p><button type="button" onClick={() => setActiveView("policy")}>Write a policy</button></div>
        ))}

        {activeView === "population" && (investigation.population ? (
          <section className="commerce__population" aria-label="Participant population">
            <div className="commerce__section-heading"><h3>How each audience responds</h3><p>{investigation.population.assumption}</p></div>
            <div className="commerce__population-table" role="table" aria-label="Population outcomes">
              <div className="commerce__population-header" role="row"><span role="columnheader">Strategy</span><span role="columnheader">People</span><span role="columnheader">Legitimate reward</span><span role="columnheader">Unintended payout</span><span role="columnheader">Value retained</span><span role="columnheader">Delay</span></div>
              {investigation.population.strategies.map((strategy) => (
                <div role="row" key={strategy.id}><span role="cell"><b>{strategy.label}</b><small>{strategy.objective}</small></span><span role="cell">{strategy.participants}</span><span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd === 0 ? strategy.metrics.availableRewardUsd : 0)}</span><span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd)}</span><span role="cell">{dollars(strategy.metrics.retainedRevenueUsd)}</span><span role="cell">{strategy.metrics.rewardDelayDays ?? "—"} days</span></div>
              ))}
            </div>
          </section>
        ) : <div className="commerce__empty"><h3>No audience simulation yet</h3><button type="button" onClick={() => setActiveView("policy")}>Write a policy</button></div>)}

        {activeView === "repairs" && (recommended ? (
          <section className="commerce__repairs" aria-labelledby="repairs-title">
            <div className="commerce__section-heading">
              <h3 id="repairs-title">Choose what matters most</h3>
              <div className="commerce__priorities" aria-label="Policy owner priorities">
                {(Object.keys(priorityLabels) as CommercePriority[]).map((value) => <button key={value} type="button" aria-pressed={priority === value} onClick={() => setPriority(value)}>{priorityLabels[value]}</button>)}
              </div>
            </div>
            <div className="commerce__recommendation" role="region" aria-label="Recommended design"><span>Recommended for {priorityLabels[priority]}</span><b>{recommended.label}</b><p>{recommended.tradeoff}</p></div>
            <div className="commerce__candidate-grid">
              {rankedCandidates.map((candidate) => (
                <article key={candidate.id}>
                  <div><span className="commerce__complexity">Complexity {candidate.complexity} / 3</span><h3>{candidate.label}</h3><p>{candidate.tradeoff}</p></div>
                  <dl><div><dt>Leakage</dt><dd>{dollars(candidate.evaluation.attack.verifiedUnintendedPayoutUsd)}</dd></div><div><dt>Honest reward</dt><dd>{dollars(candidate.evaluation.honest.availableRewardUsd)}</dd></div><div><dt>Value retained</dt><dd>{dollars(candidate.evaluation.honest.retainedRevenueUsd)}</dd></div><div><dt>Delay</dt><dd>{candidate.evaluation.honest.rewardDelayDays ?? "—"} days</dd></div></dl>
                  <div className="commerce__candidate-actions"><button type="button" onClick={() => setFreshTest({ label: candidate.label, leakage: candidate.evaluation.attack.verifiedUnintendedPayoutUsd, honestReward: candidate.evaluation.honest.availableRewardUsd, delay: candidate.evaluation.honest.rewardDelayDays, provenance: "host" })}>Replay known attack</button><button type="button" disabled={connection !== "ready" || isRunning} onClick={() => void requestInvestigation(commercePolicyText(candidate.policy), "fresh", candidate.label)}>Fresh Muse attack</button></div>
                </article>
              ))}
            </div>
            {freshTest && <div className="commerce__fresh-test" role="status" aria-label="Fresh repair test"><b>{freshTest.leakage === 0 ? "Known trace blocked" : "Leakage remains"}</b><span>{freshTest.label}</span><span>{dollars(freshTest.leakage)} unintended</span><span>{dollars(freshTest.honestReward)} honest reward</span><span>{freshTest.delay ?? "—"} day delay</span><small>{freshTest.provenance === "live" ? "Fresh Muse attempt · host verified" : "Host regression replay"}</small></div>}
          </section>
        ) : <div className="commerce__empty"><h3>No repairs to compare yet</h3><button type="button" onClick={() => setActiveView("policy")}>Write a policy</button></div>)}
      </div>

      <footer className="commerce__footer">
        <p>{investigation.provenance === "live" ? "Live Muse investigation" : "Recorded Muse investigation"} · host replayed{investigation.usage.actualUsd > 0 ? ` · $${investigation.usage.actualUsd.toFixed(4)} model cost` : ""}</p>
        <p>Only host-computed observations count as evidence.</p>
      </footer>
    </section>
  );
}
