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
      <div className="commerce__hero">
        <div>
          <p className="eyebrow">Commerce incentive studio · policy before launch</p>
          <h2 id="commerce-title">What behaviour are you actually paying for?</h2>
          <p>
            Paste a proposed rewards programme. Muse looks for strategic behaviour; deterministic
            ledgers decide what actually paid, what stayed, and which repairs preserve customer value.
          </p>
        </div>
        <dl className="commerce__headline-metrics">
          <div><dt>Spendable credit</dt><dd>{dollars(investigation.attack?.verification.availableRewardUsd ?? 0)}</dd></div>
          <div><dt>Retained revenue</dt><dd>{dollars(investigation.attack?.verification.retainedRevenueUsd ?? 0)}</dd></div>
          <div><dt>Required transactions</dt><dd>{investigation.attack?.minimizedActions.length ?? 0}</dd></div>
        </dl>
      </div>

      <nav className="domain-nav" aria-label="Simulation domains">
        <a aria-current="page" href="#commerce">Commerce incentives</a>
        <a href="#bottle-return">Bottle Return evidence</a>
      </nav>

      <section className="commerce__input" aria-labelledby="commerce-input-title">
        <div className="commerce__section-heading">
          <div>
            <p className="eyebrow">01 · Define rules and intent separately</p>
            <h3 id="commerce-input-title">Programme brief</h3>
          </div>
          <p className={`commerce__connection commerce__connection--${connection}`} role="status">
            {connection === "ready"
              ? `Live investigation ready${availableBudget === null ? "" : ` · $${availableBudget.toFixed(2)} budget left`}`
              : connection === "checking"
                ? "Checking live investigation"
                : "Recorded evidence mode"}
          </p>
        </div>
        <div className="commerce__form-grid">
          <label className="commerce__policy-field">
            <span>Proposed rewards programme</span>
            <textarea
              rows={5}
              maxLength={4_000}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
            />
          </label>
          <label htmlFor="commerce-minimum-revenue">
            <span>Minimum retained revenue</span>
            <span className="commerce__money-input"><b aria-hidden="true">$</b><input aria-label="Minimum retained revenue" id="commerce-minimum-revenue" min="1" max="10000" step="1" type="number" value={minimumRevenue} onChange={(event) => setMinimumRevenue(event.target.value)} /></span>
          </label>
          <label>
            <span>Restrictions that must remain</span>
            <textarea rows={3} maxLength={3_000} value={restrictions} onChange={(event) => setRestrictions(event.target.value)} />
          </label>
        </div>
        <div className="commerce__actions">
          <button
            type="button"
            disabled={connection !== "ready" || isRunning || sourceText.trim().length === 0}
            onClick={() => void requestInvestigation(sourceText, "primary")}
          >
            {isRunning ? "Investigating…" : "Investigate with Muse"}
          </button>
          <button
            type="button"
            onClick={() => {
              setInvestigation(recordedCommerceInvestigation);
              setMessage(null);
              setFreshTest(null);
            }}
          >
            Load verified example
          </button>
          {message && <p aria-live="polite">{message}</p>}
        </div>
      </section>

      <section className="commerce__mapping paper-card" aria-labelledby="mapping-title">
        <div className="commerce__section-heading">
          <div>
            <p className="eyebrow">02 · Inspect the mapping</p>
            <h3 id="mapping-title">Supported policy mapping</h3>
          </div>
          <strong>{investigation.mapping.status === "candidate" ? "Ready for host replay" : "Needs a wider simulator"}</strong>
        </div>
        <p>{investigation.mapping.reason}</p>
        <div className="commerce__mapping-lists">
          <div>
            <b>Represented exactly</b>
            <ul>{investigation.mapping.supportedClauses.map((clause) => <li key={clause}>{clause}</li>)}</ul>
          </div>
          <div>
            <b>Not represented</b>
            {investigation.mapping.unsupportedConditions.length === 0
              ? <p>None in this mapping.</p>
              : <ul>{investigation.mapping.unsupportedConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>}
          </div>
        </div>
        {investigation.mapping.policy && (
          <dl className="commerce__policy-map">
            <div><dt>Reward</dt><dd>{dollars(investigation.mapping.policy.referral.rewardUsd)} each</dd></div>
            <div><dt>Threshold</dt><dd>{dollars(investigation.mapping.policy.referral.qualifyingPurchaseUsd)}</dd></div>
            <div><dt>Qualification</dt><dd>{investigation.mapping.policy.referral.qualificationBasis.replaceAll("_", " ")}</dd></div>
            <div><dt>Issuance</dt><dd>{investigation.mapping.policy.referral.issuance.replaceAll("_", " ")}</dd></div>
            <div><dt>Refund</dt><dd>{investigation.mapping.policy.referral.refundHandling}</dd></div>
            <div><dt>Return window</dt><dd>{investigation.mapping.policy.referral.returnWindowDays} days</dd></div>
          </dl>
        )}
      </section>

      {investigation.attack && (
        <section className="commerce__counterexample" aria-label="Verified counterexample">
          <div className="commerce__counterexample-intro">
            <p className="eyebrow">03 · Minimal inspectable counterexample</p>
            <h3>{investigation.attack.verification.status === "exploit_verified" ? "Exploit verified" : "Candidate not verified"}</h3>
            <p><b>Model hypothesis · unverified wording</b>{investigation.attack.hypothesis}</p>
            <p><b>Host verdict</b>{investigation.attack.verification.reason}</p>
            <strong>{investigation.attack.proposedActionCount} proposed → {investigation.attack.minimizedActions.length} required transactions</strong>
          </div>
          <ol className="commerce__trace">
            {investigation.attack.events.map((event) => (
              <li key={event.sequence}>
                <span>{String(event.sequence).padStart(2, "0")}</span>
                <div><b>{event.summary}</b><small>{event.clause}</small><p>{event.ledgerEffect}</p></div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {investigation.population && (
        <section className="commerce__population paper-card" aria-label="Participant population">
          <div className="commerce__section-heading">
            <div><p className="eyebrow">04 · Competing participant strategies</p><h3>Population behaviour</h3></div>
            <p>{investigation.population.assumption}</p>
          </div>
          <div className="commerce__population-table" role="table" aria-label="Population outcomes">
            <div className="commerce__population-header" role="row"><span role="columnheader">Strategy</span><span role="columnheader">Participants</span><span role="columnheader">Legitimate reward</span><span role="columnheader">Unintended payout</span><span role="columnheader">Retained revenue</span><span role="columnheader">Delay</span></div>
            {investigation.population.strategies.map((strategy) => (
              <div role="row" key={strategy.id}>
                <span role="cell"><b>{strategy.label}</b><small>{strategy.objective}</small></span>
                <span role="cell">{strategy.participants}</span>
                <span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd === 0 ? strategy.metrics.availableRewardUsd : 0)}</span>
                <span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd)}</span>
                <span role="cell">{dollars(strategy.metrics.retainedRevenueUsd)}</span>
                <span role="cell">{strategy.metrics.rewardDelayDays ?? "—"} days</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {recommended && (
        <section className="commerce__repairs" aria-labelledby="repairs-title">
          <div className="commerce__section-heading">
            <div><p className="eyebrow">05 · Choose the tradeoff</p><h3 id="repairs-title">Tested policy designs</h3></div>
            <div className="commerce__priorities" aria-label="Policy owner priorities">
              {(Object.keys(priorityLabels) as CommercePriority[]).map((value) => (
                <button key={value} type="button" aria-pressed={priority === value} onClick={() => setPriority(value)}>
                  Prioritize {priorityLabels[value]}
                </button>
              ))}
            </div>
          </div>
          <div className="commerce__recommendation" role="region" aria-label="Recommended design">
            <span>Best tested fit for {priorityLabels[priority]}</span>
            <b>{recommended.label}</b>
            <p>{recommended.tradeoff}</p>
          </div>
          <div className="commerce__candidate-grid">
            {rankedCandidates.map((candidate) => (
              <article key={candidate.id}>
                <div><p className="eyebrow">Complexity {candidate.complexity} / 3</p><h3>{candidate.label}</h3><p>{candidate.tradeoff}</p></div>
                <dl>
                  <div><dt>Known leakage</dt><dd>{dollars(candidate.evaluation.attack.verifiedUnintendedPayoutUsd)}</dd></div>
                  <div><dt>Honest reward</dt><dd>{dollars(candidate.evaluation.honest.availableRewardUsd)}</dd></div>
                  <div><dt>Retained revenue</dt><dd>{dollars(candidate.evaluation.honest.retainedRevenueUsd)}</dd></div>
                  <div><dt>Reward delay</dt><dd>{candidate.evaluation.honest.rewardDelayDays ?? "—"} days</dd></div>
                </dl>
                <div className="commerce__candidate-actions">
                  <button type="button" onClick={() => setFreshTest({ label: candidate.label, leakage: candidate.evaluation.attack.verifiedUnintendedPayoutUsd, honestReward: candidate.evaluation.honest.availableRewardUsd, delay: candidate.evaluation.honest.rewardDelayDays, provenance: "host" })}>
                    Host-test {candidate.label}
                  </button>
                  <button type="button" disabled={connection !== "ready" || isRunning} onClick={() => void requestInvestigation(commercePolicyText(candidate.policy), "fresh", candidate.label)}>
                    Fresh-attack with Muse
                  </button>
                </div>
              </article>
            ))}
          </div>
          {freshTest && (
            <div className="commerce__fresh-test" role="status" aria-label="Fresh repair test">
              <b>{freshTest.leakage === 0 ? "Known trace blocked" : "Leakage remains"}</b>
              <span>{freshTest.label}</span>
              <span>{dollars(freshTest.leakage)} unintended payout</span>
              <span>{dollars(freshTest.honestReward)} honest reward</span>
              <span>{freshTest.delay ?? "—"} day reward delay</span>
              <small>{freshTest.provenance === "live" ? "Fresh Muse attempt · host verified" : "Fresh host regression replay"}</small>
            </div>
          )}
        </section>
      )}

      <footer className="commerce__footer">
        <p>
          {investigation.provenance === "live" ? "Live Muse investigation · host replayed" : "Recorded Muse investigation · host replayed"}
          {investigation.usage.actualUsd > 0 ? ` · $${investigation.usage.actualUsd.toFixed(4)} model cost` : ""}
        </p>
        <a href="#bottle-return">See the same workflow in Bottle Return ↓</a>
      </footer>
    </section>
  );
}
