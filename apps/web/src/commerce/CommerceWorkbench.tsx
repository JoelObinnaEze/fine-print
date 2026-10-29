import { useEffect, useMemo, useState } from "react";

import {
  commercePolicyText,
  commerceRestrictions,
  commerceSourceText,
  createCommerceGoal,
  rankCommerceCandidates,
  recordedCommerceInvestigation,
  recordedCommerceRepairTest,
  type CommerceInvestigationView,
  type CommercePriority,
} from "./recorded-investigation.js";
import { handleTabKeyDown } from "../tab-navigation.js";
import { isStaticDemo } from "../static-demo.js";

const priorityLabels: Readonly<Record<CommercePriority, string>> = {
  low_leakage: "strongest protection",
  fast_rewards: "fastest reward",
  simple_operations: "simple operations",
  least_disruption: "least disruption",
};

function dollars(value: number): string {
  return `$${value}`;
}

type CommerceView = "policy" | "exploit" | "repairs";

const commerceViews: readonly {
  readonly id: CommerceView;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: "policy", label: "Step 1 · Your rule", description: "What should happen" },
  { id: "exploit", label: "Step 2 · What went wrong", description: "Confirmed replay" },
  { id: "repairs", label: "Step 3 · Best repair", description: "Keep honest rewards" },
];

export function CommerceWorkbench() {
  const [sourceText, setSourceText] = useState(commerceSourceText);
  const [minimumRevenue, setMinimumRevenue] = useState("20");
  const [restrictions, setRestrictions] = useState(commerceRestrictions);
  const [connection, setConnection] = useState<"checking" | "ready" | "offline">("checking");
  const [investigation, setInvestigation] = useState<CommerceInvestigationView>(
    recordedCommerceInvestigation,
  );
  const [priority, setPriority] = useState<CommercePriority>("fast_rewards");
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [freshTest, setFreshTest] = useState<{
    readonly label: string;
    readonly verdict: "This trace was blocked" | "No failure found in this attempt" | "Test could not be replayed" | "Failure still present";
    readonly leakage: number;
    readonly honestReward: number;
    readonly delay: number | null;
    readonly note?: string;
    readonly provenance: "host" | "live" | "recorded" | "search";
  } | null>(recordedCommerceRepairTest);
  const [activeView, setActiveView] = useState<CommerceView>("exploit");

  useEffect(() => {
    if (isStaticDemo) {
      setConnection("offline");
      return;
    }
    let active = true;
    void fetch("/api/health")
      .then(async (healthResponse) => {
        if (!healthResponse.ok) throw new Error("Server unavailable");
        const health = (await healthResponse.json()) as {
          readonly liveAgent?: { readonly isEnabled?: boolean };
        };
        if (!active) return;
        setConnection(health.liveAgent?.isEnabled ? "ready" : "offline");
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
  const attackStatus = investigation.attack?.verification.status;
  const attackOutcome =
    attackStatus === "exploit_verified"
      ? {
          label: "Failure confirmed",
          title: `${dollars(investigation.attack!.verification.availableRewardUsd)} was rewarded after the business kept ${dollars(investigation.attack!.verification.retainedRevenueUsd)}.`,
          trace: `${investigation.attack!.proposedActionCount} proposed → ${investigation.attack!.minimizedActions.length} needed`,
        }
      : attackStatus === "candidate_invalid"
        ? {
            label: "Test could not be replayed",
            title: "The simulator rejected this transaction sequence.",
            trace: `${investigation.attack!.proposedActionCount} proposed · not executable`,
          }
        : {
            label: "No failure found",
            title: "This attempt did not show a reward without lasting value.",
            trace: `${investigation.attack?.proposedActionCount ?? 0} proposed · ${investigation.attack?.minimizedActions.length ?? 0} replayed`,
          };
  const mappedPolicy = investigation.mapping.policy;
  const mappedSummary = mappedPolicy
    ? `${dollars(mappedPolicy.referral.rewardUsd)} each after a ${dollars(mappedPolicy.referral.qualifyingPurchaseUsd)} purchase; ${mappedPolicy.referral.issuance.replaceAll("_", " ")}; rewards ${mappedPolicy.referral.refundHandling === "reverse" ? "reversed" : "kept"} after a refund.`
    : investigation.mapping.reason;

  const requestInvestigation = async (
    text: string,
    mode: "primary" | "fresh",
    freshCandidate?: CommerceInvestigationView["candidates"][number],
  ) => {
    const minimumUsd = Number(minimumRevenue);
    if (!Number.isInteger(minimumUsd) || minimumUsd < 1 || minimumUsd > 10_000) {
      setMessage("Minimum retained revenue must be a whole-dollar amount from 1 to 10000.");
      return;
    }
    if (mode === "fresh") setFreshTest(null);
    setIsRunning(true);
    setMessage(mode === "primary" ? "Muse is mapping and testing the programme…" : "Muse is rechecking the selected repair…");
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
          ...(mode === "fresh" && freshCandidate
            ? {
                mode: "attack_only",
                evidenceContext: {
                  evidenceSetId: investigation.evidenceSetId,
                  testedCandidateId: freshCandidate.id,
                  expectedPolicyHash: freshCandidate.policyHash,
                },
              }
            : {}),
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
        if (!liveResult.attack) {
          throw new Error(`Fresh recheck could not run: ${liveResult.mapping.reason}`);
        }
        const ordinaryResult = liveResult.population?.strategies.find(
          (strategy) => strategy.id === "ordinary",
        );
        setFreshTest({
          label: freshCandidate?.label ?? "Selected design",
          verdict:
            liveResult.attack.verification.status === "exploit_verified"
              ? "Failure still present"
              : liveResult.attack.verification.status === "candidate_invalid"
                ? "Test could not be replayed"
                : "No failure found in this attempt",
          leakage: liveResult.attack?.verification.unintendedPayoutUsd ?? 0,
          honestReward: ordinaryResult?.metrics.availableRewardUsd ?? 0,
          delay: ordinaryResult?.metrics.rewardDelayDays ?? null,
          ...(liveResult.attack.modelProposalStatus === "candidate_invalid" &&
          liveResult.attack.searchOutcome === "no_failure_found"
            ? {
                note: `Muse's proposal was rejected; systematic search completed across ${liveResult.attack.searchExpandedStates} states.`,
              }
            : {}),
          provenance:
            liveResult.attack.searchOutcome !== "not_run" ? "search" : "live",
        });
        if (
          liveResult.evidenceUpdate?.evidenceSetId === investigation.evidenceSetId
        ) {
          setInvestigation((current) => ({
            ...current,
            candidates: liveResult.evidenceUpdate!.candidates,
          }));
        }
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commerce investigation failed.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="commerce" id="commerce" aria-labelledby="commerce-title">
      <header className="commerce__hero">
        <div className="commerce__hero-copy">
          <h2 id="commerce-title">Test whether rewards outlive value.</h2>
          <p>Fine Print asks Muse how a reward rule could fail, replays the idea in a deterministic simulator, and compares repairs that still reward honest customers.</p>
        </div>
        <dl className="commerce__headline-metrics">
          <div><dt>Reward paid</dt><dd>{attackStatus === "candidate_invalid" ? "—" : dollars(investigation.attack?.verification.unintendedPayoutUsd ?? 0)}</dd></div>
          <div><dt>Value kept</dt><dd>{attackStatus === "candidate_invalid" ? "—" : dollars(investigation.attack?.verification.retainedRevenueUsd ?? 0)}</dd></div>
          <div><dt>Shortest proof</dt><dd>{attackStatus === "exploit_verified" ? investigation.attack?.minimizedActions.length : "—"}{attackStatus === "exploit_verified" && <small> steps</small>}</dd></div>
        </dl>
      </header>

      <nav className="commerce__steps" aria-label="Commerce investigation" role="tablist" onKeyDown={handleTabKeyDown}>
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
                <h3 id="commerce-input-title">Describe the rule and what success means</h3>
                <p className={`commerce__connection commerce__connection--${connection}`} role="status">
                  {connection === "ready"
                    ? "Ready"
                    : connection === "checking" ? "Checking connection" : isStaticDemo ? "Recorded demo" : "Recorded mode"}
                </p>
              </div>
              <div className="commerce__form-grid">
                <label className="commerce__policy-field">
                  <span>Rewards rule</span>
                  <textarea rows={5} maxLength={4_000} value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
                </label>
                <label htmlFor="commerce-minimum-revenue">
                  <span>Minimum value the business must keep</span>
                  <span className="commerce__money-input"><b aria-hidden="true">$</b><input aria-label="Minimum value the business must keep" id="commerce-minimum-revenue" min="1" max="10000" step="1" type="number" value={minimumRevenue} onChange={(event) => setMinimumRevenue(event.target.value)} /></span>
                </label>
                <label>
                  <span>Honest customer promise to preserve</span>
                  <textarea rows={3} maxLength={3_000} value={restrictions} onChange={(event) => setRestrictions(event.target.value)} />
                </label>
              </div>
              <div className="commerce__actions">
                <button type="button" disabled={connection !== "ready" || isRunning || sourceText.trim().length === 0} onClick={() => void requestInvestigation(sourceText, "primary")}>
                  {isRunning ? "Testing…" : "Test my rule"}
                </button>
                <button type="button" onClick={() => { setInvestigation(recordedCommerceInvestigation); setMessage(null); setFreshTest(recordedCommerceRepairTest); setActiveView("exploit"); }}>
                  Load example
                </button>
                {message && <p aria-live="polite">{message}</p>}
              </div>
            </section>

            <section className="commerce__mapping" aria-labelledby="mapping-title">
              <div className="commerce__section-heading">
                <h3 id="mapping-title">How Fine Print understood it</h3>
                <strong>{investigation.mapping.status === "candidate" ? "Ready to test" : "Needs wider support"}</strong>
              </div>
              <p className="commerce__policy-summary">{mappedSummary}</p>
              {investigation.mapping.unsupportedConditions.length > 0 && <p><b>Not represented:</b> {investigation.mapping.unsupportedConditions.join(", ")}.</p>}
              <details className="commerce__technical">
                <summary>Show technical rule mapping</summary>
                <p>{investigation.mapping.reason}</p>
                <div className="commerce__mapping-lists">
                  <div><b>Represented</b><ul>{investigation.mapping.supportedClauses.map((clause) => <li key={clause}>{clause}</li>)}</ul></div>
                  <div><b>Unsupported</b>{investigation.mapping.unsupportedConditions.length === 0 ? <p>Nothing material.</p> : <ul>{investigation.mapping.unsupportedConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>}</div>
                </div>
                {mappedPolicy && (
                  <dl className="commerce__policy-map">
                    <div><dt>Reward</dt><dd>{dollars(mappedPolicy.referral.rewardUsd)} each</dd></div>
                    <div><dt>Purchase needed</dt><dd>{dollars(mappedPolicy.referral.qualifyingPurchaseUsd)}</dd></div>
                    <div><dt>Basis</dt><dd>{mappedPolicy.referral.qualificationBasis.replaceAll("_", " ")}</dd></div>
                    <div><dt>Timing</dt><dd>{mappedPolicy.referral.issuance.replaceAll("_", " ")}</dd></div>
                    <div><dt>After refund</dt><dd>{mappedPolicy.referral.refundHandling}</dd></div>
                    <div><dt>Return window</dt><dd>{mappedPolicy.referral.returnWindowDays} days</dd></div>
                  </dl>
                )}
              </details>
            </section>
          </div>
        )}

        {activeView === "exploit" && (investigation.attack ? (
          <section className="commerce__counterexample" aria-label="Investigation outcome">
            <div className="commerce__counterexample-intro">
              <div className="commerce__verdict-row"><span>{attackOutcome.label}</span><strong>{attackOutcome.trace}</strong></div>
              <h3>{attackOutcome.title}</h3>
              <p>These are the shortest transactions the simulator needed to confirm what happened.</p>
              <details className="commerce__technical commerce__technical--dark">
                <summary>Show verification details</summary>
                <p><b>{investigation.attack.discoveryMethod === "deterministic_search" ? "Systematic search" : "AI test idea"}</b>{investigation.attack.hypothesis}</p>
                {investigation.attack.searchOutcome !== "not_run" && <p><b>Search coverage</b>{investigation.attack.searchExpandedStates} states expanded · {investigation.attack.searchOutcome === "failure_found" ? "failure found" : "no failure found within this attempt"}{investigation.attack.modelProposalStatus === "candidate_invalid" ? " · AI proposal rejected" : ""}</p>}
                <p><b>Simulator result</b>{investigation.attack.verification.reason}</p>
              </details>
            </div>
            <ol className="commerce__trace">
              {investigation.attack.events.map((event) => (
                <li key={event.sequence}><span>{String(event.sequence).padStart(2, "0")}</span><div><b>{event.summary}</b><small>{event.clause}</small><p>{event.ledgerEffect}</p></div></li>
              ))}
            </ol>
          </section>
        ) : (
          <div className="commerce__empty"><h3>No confirmed failure yet</h3><p>Start with a rule and the value the business must keep.</p><button type="button" onClick={() => setActiveView("policy")}>Write a rule</button></div>
        ))}

        {activeView === "repairs" && (recommended ? (
          <section className="commerce__repairs" aria-labelledby="repairs-title">
            <div className="commerce__section-heading">
              <h3 id="repairs-title">Choose the best repair for your programme</h3>
            </div>
            <div className="commerce__recommendation" role="region" aria-label="Recommended repair">
              <div className="commerce__recommendation-copy">
                <h3>{recommended.label}</h3>
                <p><b>Lowest exposure observed across {recommended.evaluation.evidence.applicableCases} confirmed case{recommended.evaluation.evidence.applicableCases === 1 ? "" : "s"}, then {priorityLabels[priority]}.</b> {recommended.tradeoff}</p>
                <small>Observed under tested cases, not a guaranteed maximum.</small>
              </div>
              <dl>
                <div><dt>Reward value exposed</dt><dd>{dollars(recommended.evaluation.attack.verifiedUnintendedPayoutUsd)}</dd></div>
                <div><dt>Honest reward</dt><dd>{dollars(recommended.evaluation.honest.availableRewardUsd)}</dd></div>
                <div><dt>Customer wait</dt><dd>{recommended.evaluation.honest.rewardDelayDays ?? "—"} day{recommended.evaluation.honest.rewardDelayDays === 1 ? "" : "s"}</dd></div>
              </dl>
              <div className="commerce__candidate-actions">
                <button type="button" onClick={() => setFreshTest({ label: recommended.label, verdict: recommended.evaluation.attack.verifiedUnintendedPayoutUsd === 0 ? "This trace was blocked" : "Failure still present", leakage: recommended.evaluation.attack.verifiedUnintendedPayoutUsd, honestReward: recommended.evaluation.honest.availableRewardUsd, delay: recommended.evaluation.honest.rewardDelayDays, provenance: "host" })}>Replay known failure</button>
                {isStaticDemo
                  ? <small className="commerce__static-note">Live rechecks are disabled in the public demo.</small>
                  : <button type="button" disabled={connection !== "ready" || isRunning} onClick={() => void requestInvestigation(commercePolicyText(recommended.policy), "fresh", recommended)}>Run fresh recheck</button>}
              </div>
            </div>
            {message && <p aria-live="polite">{message}</p>}
            {freshTest && <div className={`commerce__fresh-test${freshTest.verdict === "Failure still present" ? " commerce__fresh-test--failure" : ""}`} role="status" aria-label="Fresh repair test"><b>{freshTest.verdict}</b><span>{freshTest.label}</span><span>{dollars(freshTest.leakage)} reward value exposed</span><span>{dollars(freshTest.honestReward)} honest reward</span><span>{freshTest.delay ?? "—"} day wait</span>{freshTest.note && <span>{freshTest.note}</span>}<small>{freshTest.provenance === "live" ? "Fresh AI recheck · simulator replayed" : freshTest.provenance === "search" ? "Systematic action search · simulator replayed" : freshTest.provenance === "recorded" ? "Recorded AI recheck · simulator replayed" : "Simulator regression replay"}</small></div>}
            <details className="commerce__technical commerce__repair-options">
              <summary>Compare all repairs</summary>
              <div className="commerce__priorities" aria-label="Policy owner priorities">
                {(Object.keys(priorityLabels) as CommercePriority[]).map((value) => <button key={value} type="button" aria-pressed={priority === value} onClick={() => setPriority(value)}>{priorityLabels[value]}</button>)}
              </div>
              <div className="commerce__candidate-grid">
                {rankedCandidates.map((candidate) => (
                  <article key={candidate.id}>
                    <div><h3>{candidate.label}</h3><span className="commerce__complexity">Complexity {candidate.complexity} / 3</span><p>{candidate.tradeoff}</p></div>
                    <dl><div><dt>Reward value exposed</dt><dd>{dollars(candidate.evaluation.attack.verifiedUnintendedPayoutUsd)}<small>Observed in {candidate.evaluation.evidence.applicableCases} confirmed case{candidate.evaluation.evidence.applicableCases === 1 ? "" : "s"}</small></dd></div><div><dt>Honest reward</dt><dd>{dollars(candidate.evaluation.honest.availableRewardUsd)}</dd></div><div><dt>Value kept</dt><dd>{dollars(candidate.evaluation.honest.retainedRevenueUsd)}</dd></div><div><dt>Customer wait</dt><dd>{candidate.evaluation.honest.rewardDelayDays ?? "—"} days</dd></div></dl>
                    <div className="commerce__candidate-actions"><button type="button" onClick={() => setFreshTest({ label: candidate.label, verdict: candidate.evaluation.attack.verifiedUnintendedPayoutUsd === 0 ? "This trace was blocked" : "Failure still present", leakage: candidate.evaluation.attack.verifiedUnintendedPayoutUsd, honestReward: candidate.evaluation.honest.availableRewardUsd, delay: candidate.evaluation.honest.rewardDelayDays, provenance: "host" })}>Replay known failure</button>{!isStaticDemo && <button type="button" disabled={connection !== "ready" || isRunning} onClick={() => void requestInvestigation(commercePolicyText(candidate.policy), "fresh", candidate)}>Run fresh recheck</button>}</div>
                  </article>
                ))}
              </div>
            </details>
            {investigation.population && (
              <details className="commerce__technical commerce__audience-details">
                <summary>Show audience simulation</summary>
                <section className="commerce__population" aria-label="Participant population">
                  <div className="commerce__section-heading"><h3>How each audience responds</h3><p>{investigation.population.assumption}</p></div>
                  <div className="commerce__population-table" role="table" aria-label="Population outcomes">
                    <div className="commerce__population-header" role="row"><span role="columnheader">Strategy</span><span role="columnheader">People</span><span role="columnheader">Honest reward</span><span role="columnheader">Reward value exposed</span><span role="columnheader">Value kept</span><span role="columnheader">Wait</span></div>
                    {investigation.population.strategies.map((strategy) => (
                    <div role="row" key={strategy.id}><span role="cell"><b>{strategy.label}</b><small>{strategy.objective}</small></span><span role="cell">{strategy.participants}</span><span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd === 0 ? strategy.metrics.availableRewardUsd : 0)}</span><span role="cell">{dollars(strategy.metrics.verifiedUnintendedPayoutUsd)}</span><span role="cell">{dollars(strategy.metrics.retainedRevenueUsd)}</span><span role="cell">{strategy.metrics.rewardDelayDays ?? "—"} days</span></div>
                    ))}
                  </div>
                </section>
              </details>
            )}
          </section>
        ) : <div className="commerce__empty"><h3>No repairs to compare yet</h3><button type="button" onClick={() => setActiveView("policy")}>Write a rule</button></div>)}
      </div>

      <footer className="commerce__footer">
        <p>AI proposes transaction tests. The simulator decides what happened.</p>
        <details className="commerce__run-details"><summary>Show run details</summary><p>{investigation.provenance === "live" ? "Live Muse run" : "Recorded Muse run"} · {attackStatus === "candidate_invalid" ? "simulator rejected the sequence" : "simulator replayed the sequence"}{investigation.usage.actualUsd > 0 ? ` · $${investigation.usage.actualUsd.toFixed(4)} model cost` : ""}</p></details>
      </footer>
    </section>
  );
}
