import { useEffect, useState } from "react";

import { parseAction, type Action } from "../../../../packages/engine/src/actions.js";
import type { Policy } from "../../../../packages/policy/src/index.js";
import {
  recordedMuseActions,
  startingPolicy,
  startingPolicySourceText,
} from "../replay-data.js";
import { PolicyComposer } from "./PolicyComposer.js";
import { isStaticDemo } from "../static-demo.js";

export interface RunEvidence {
  readonly provenance: "scripted_fixture" | "recorded_model_replay" | "live_model";
  readonly modelId: string | null;
  readonly requests: number;
  readonly totalTokens: number;
  readonly actualUsd: number;
  readonly runId: string | null;
  readonly verdict: string;
  readonly summary: string;
  readonly reasoning?: AttackReasoning;
}

export interface AttackReasoning {
  readonly hypothesis: string;
  readonly test: string;
  readonly observation: string;
  readonly verdict: string;
}

export interface AttackTarget {
  readonly label: string;
  readonly policy: Policy;
  readonly sourceText: string;
}

interface AttackAttempt {
  readonly status:
    | "running"
    | "verified_exploit"
    | "candidate_rejected"
    | "search_completed"
    | "search_interrupted";
  readonly target: string;
  readonly detail: string;
  readonly requests?: number;
  readonly trials?: number;
  readonly actions?: number;
  readonly runId?: string | null;
  readonly observation?: string;
  readonly traces?: readonly {
    readonly request: number;
    readonly trial: number;
    readonly kind: "trial" | "candidate";
    readonly hypothesis: string;
    readonly actions: readonly Action[];
  }[];
}

interface RegressionEvaluation {
  readonly id: string;
  readonly label: string;
  readonly expectedExcessReward: number;
  readonly blocked: boolean;
  readonly current: {
    readonly totalReward: number;
    readonly usefulItems: number;
    readonly excessReward: number;
  };
}

const attemptTitles: Record<AttackAttempt["status"], string> = {
  running: "Test in progress",
  verified_exploit: "Failure confirmed",
  candidate_rejected: "Test could not be replayed",
  search_completed: "No failure found in this attempt",
  search_interrupted: "Test interrupted",
};

function actionLabel(action: Action): string {
  if (action.type === "move") return `move ${action.direction}`;
  if ("itemId" in action) return `${action.type} ${action.itemId}`;
  return action.type;
}

function plainLanguage(text: string): string {
  return text
    .replace(/\bexploits\b/gi, "failures")
    .replace(/\bexploit\b/gi, "failure")
    .replace(/\battacking\b/gi, "testing")
    .replace(/\battack\b/gi, "test");
}

export const scriptedEvidence: RunEvidence = {
  provenance: "scripted_fixture",
  modelId: null,
  requests: 0,
  totalTokens: 0,
  actualUsd: 0,
  runId: null,
  verdict: "Deterministic teaching trace",
  summary: "A known repeated-deposit failure demonstrates the workflow without inference.",
};

const recordedEvidence: RunEvidence = {
  provenance: "recorded_model_replay",
  modelId: "muse-spark-1.3",
  requests: 10,
  totalTokens: 50_120,
  actualUsd: 0.070258,
  runId: "74e918a0-786b-4046-b415-9de2e665a6df",
  verdict: "Failure independently confirmed",
  summary: "Muse found a 30-point trace with zero useful recycling; the host preserved two rejected actions.",
  reasoning: {
    hypothesis: "The deposit trigger may pay repeatedly before useful processing is proven.",
    test: "deposit B1 → retrieve B1 → deposit B1 → retrieve B1 → deposit B1",
    observation: "30 reward points · 0 useful items",
    verdict: "Host replay verified 30 unintended reward points.",
  },
};

export function RedTeamArena({
  evidence,
  activeSourceText,
  attackTarget,
  onActivatePolicy,
  onLoadTrace,
}: {
  readonly evidence: RunEvidence;
  readonly activeSourceText: string;
  readonly attackTarget: AttackTarget;
  readonly onActivatePolicy: (policy: Policy, sourceText: string) => void;
  readonly onLoadTrace: (
    actions: readonly Action[],
    evidence: RunEvidence,
    target: AttackTarget,
  ) => void;
}) {
  const [connection, setConnection] = useState<"checking" | "ready" | "offline">("checking");
  const [isRunning, setIsRunning] = useState(false);
  const [attempt, setAttempt] = useState<AttackAttempt | null>(null);
  const [strategies, setStrategies] = useState<readonly string[]>([]);
  const [regressions, setRegressions] = useState<readonly RegressionEvaluation[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isStaticDemo) {
      setConnection("offline");
      return;
    }
    let active = true;
    void fetch("/api/health")
      .then(async (healthResponse) => {
        if (!healthResponse.ok) throw new Error("Server unavailable.");
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

  const refreshRegressions = async () => {
    const response = await fetch("/api/regressions/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: attackTarget.policy }),
    });
    if (!response.ok) throw new Error("Regression cases are unavailable.");
    const result = await response.json() as readonly RegressionEvaluation[];
    setRegressions(result);
  };

  useEffect(() => {
    if (isStaticDemo) {
      setRegressions([]);
      return;
    }
    let active = true;
    setSaveMessage(null);
    void fetch("/api/regressions/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: attackTarget.policy }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Regression cases are unavailable.");
        const result = await response.json() as readonly RegressionEvaluation[];
        if (active) setRegressions(result);
      })
      .catch(() => active && setRegressions([]));
    return () => {
      active = false;
    };
  }, [attackTarget.policy]);

  const runLiveAttack = async () => {
    setIsRunning(true);
    setAttempt({
      status: "running",
      target: attackTarget.label,
      detail: "Muse is testing hypotheses through bounded tools. This can take up to two minutes.",
    });
    setStrategies([]);
    try {
      const response = await fetch("/api/attacks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `arena-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ policy: attackTarget.policy }),
      });
      const result = (await response.json()) as {
        readonly error?: { readonly message?: string };
        readonly runId?: string | null;
        readonly modelId?: string;
        readonly verification?: {
          readonly status?: string;
          readonly totalReward?: number;
          readonly usefulItems?: number;
          readonly requestsUsed?: number;
        };
        readonly turns?: readonly { readonly strategySummary?: string }[];
        readonly usage?: {
          readonly requests?: number;
          readonly totalTokens?: number;
          readonly actualUsd?: number;
        };
        readonly report?: {
          readonly outcome?: Exclude<AttackAttempt["status"], "running">;
          readonly reason?: string;
          readonly requestsUsed?: number;
          readonly trialsCompleted?: number;
          readonly actionsTested?: number;
          readonly attemptedTraces?: readonly {
            readonly request: number;
            readonly trial: number;
            readonly kind: "trial" | "candidate";
            readonly hypothesis: string;
            readonly actions: readonly unknown[];
          }[];
        };
      };
      if (!response.ok || !result.verification || !result.usage || !result.report?.outcome) {
        throw new Error(result.error?.message ?? "The live search did not return a verified trace.");
      }
      const traces = (result.report.attemptedTraces ?? []).map((trace) => ({
        ...trace,
        hypothesis: plainLanguage(trace.hypothesis),
        actions: trace.actions.map(parseAction),
      }));
      const strategySummaries = (result.turns ?? [])
        .map((turn) => turn.strategySummary?.trim())
        .filter((summary): summary is string => Boolean(summary));
      setStrategies(strategySummaries);
      setAttempt({
        status: result.report.outcome,
        target: attackTarget.label,
        detail: plainLanguage(result.report.reason ?? "The simulator did not provide an outcome reason."),
        requests: result.report.requestsUsed ?? result.usage.requests ?? 0,
        trials: result.report.trialsCompleted ?? 0,
        actions: result.report.actionsTested ?? 0,
        runId: result.runId ?? null,
        observation: `${result.verification.totalReward ?? 0} reward points · ${result.verification.usefulItems ?? 0} useful items`,
        traces,
      });
      if (result.report.outcome !== "verified_exploit") return;
      if (!result.runId) throw new Error("The verified search did not return a replay ID.");
      const exportResponse = await fetch(`/api/runs/${result.runId}/export`);
      if (!exportResponse.ok) throw new Error("The verified replay export was unavailable.");
      const exported = (await exportResponse.json()) as { readonly actions?: readonly unknown[] };
      if (!Array.isArray(exported.actions)) throw new Error("The replay export was invalid.");
      const actions = exported.actions.map(parseAction);
      const candidateTrace = traces.find((trace) => trace.kind === "candidate");
      onLoadTrace(
        actions,
        {
          provenance: "live_model",
          modelId: result.modelId ?? "Meta model",
          requests: result.usage.requests ?? result.verification.requestsUsed ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
          actualUsd: result.usage.actualUsd ?? 0,
          runId: result.runId,
          verdict:
            result.verification.status === "exploit_verified"
              ? "Failure independently confirmed"
              : "Bounded test completed",
          summary: `${result.verification.totalReward ?? 0} reward points versus ${result.verification.usefulItems ?? 0} useful items.`,
          ...(candidateTrace
            ? {
                reasoning: {
                  hypothesis: candidateTrace.hypothesis,
                  test: candidateTrace.actions.map(actionLabel).join(" → "),
                  observation: `${result.verification.totalReward ?? 0} reward points · ${result.verification.usefulItems ?? 0} useful items`,
                  verdict: plainLanguage(result.report.reason ?? "Simulator verification completed."),
                },
              }
            : {}),
        },
        attackTarget,
      );
      setAttempt({
        status: "verified_exploit",
        target: attackTarget.label,
        detail: "The exact transaction trace is ready in Step 2. Every reward was recomputed by the simulator.",
        requests: result.report.requestsUsed ?? result.usage.requests ?? 0,
        trials: result.report.trialsCompleted ?? 0,
        actions: result.report.actionsTested ?? 0,
        runId: result.runId ?? null,
        observation: `${result.verification.totalReward ?? 0} reward points · ${result.verification.usefulItems ?? 0} useful items`,
        traces,
      });
    } catch (error) {
      setAttempt({
        status: "search_interrupted",
        target: attackTarget.label,
        detail: plainLanguage(error instanceof Error ? error.message : "The live test failed."),
      });
    } finally {
      setIsRunning(false);
    }
  };

  const saveRegression = async () => {
    if (!attempt?.runId) return;
    setSaveMessage("Saving verified trace…");
    try {
      const response = await fetch("/api/regressions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: attempt.runId, label: `${attempt.target} failure` }),
      });
      const result = await response.json() as {
        readonly error?: { readonly message?: string };
        readonly regressionCase?: { readonly label?: string };
      };
      if (!response.ok) throw new Error(result.error?.message ?? "Regression case could not be saved.");
      setSaveMessage(`Saved permanent check: ${plainLanguage(result.regressionCase?.label ?? attempt.target)}.`);
      await refreshRegressions();
    } catch (error) {
      setSaveMessage(plainLanguage(error instanceof Error ? error.message : "Regression case could not be saved."));
    }
  };

  return (
    <section className="arena" aria-label="Rule test">
      <PolicyComposer
        connection={connection}
        sourceText={activeSourceText}
        onActivate={onActivatePolicy}
      />

      <div className="arena__proof">
        {attempt && (
          <div
            aria-label="Latest test result"
            className={`arena__attempt arena__attempt--${attempt.status}`}
            role="status"
          >
            <strong>{attemptTitles[attempt.status]}</strong>
            <span>{attempt.target}</span>
            <p>{attempt.detail}</p>
            <details className="commerce__technical commerce__technical--dark arena__details">
              <summary>Show test details</summary>
              <dl>
                <div><dt>Target</dt><dd>{attempt.target}</dd></div>
                <div><dt>Provenance</dt><dd>Live Meta test</dd></div>
                {attempt.requests !== undefined && <div><dt>Requests</dt><dd>{attempt.requests} requests</dd></div>}
                {attempt.trials !== undefined && <div><dt>Trials</dt><dd>{attempt.trials} trials</dd></div>}
                {attempt.actions !== undefined && <div><dt>Actions tested</dt><dd>{attempt.actions} actions</dd></div>}
              </dl>
              {attempt.traces && attempt.traces.length > 0 && (
                <div className="arena__traces">
                  <h3>{attempt.traces.length} attempted trace{attempt.traces.length === 1 ? "" : "s"}</h3>
                <ol>
                  {attempt.traces.map((trace) => (
                    <li key={`${trace.request}-${trace.trial}-${trace.kind}`}>
                      <b>Request {trace.request} · trial {trace.trial} · {trace.kind}</b>
                      <small>AI test idea</small>
                      <span>{trace.hypothesis}</span>
                      <small>Test actions</small>
                      <code>{trace.actions.map(actionLabel).join(" → ")}</code>
                      {trace.kind === "candidate" && attempt.observation && (
                        <>
                          <small>Simulator result</small>
                          <span>{attempt.observation}</span>
                          <small>Verdict</small>
                          <span>{attempt.detail}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                </div>
              )}
            </details>
            {attempt.status === "verified_exploit" && attempt.runId && (
              <button className="arena__save-regression" type="button" onClick={() => void saveRegression()}>
                Save as permanent check
              </button>
            )}
            {saveMessage && <p aria-live="polite">{saveMessage}</p>}
          </div>
        )}
        <button
          className="arena__primary"
          type="button"
          disabled={connection !== "ready" || isRunning}
          onClick={() => void runLiveAttack()}
        >
          {isRunning
            ? `Muse is testing ${attackTarget.label}…`
            : attackTarget.label === "active policy"
              ? "Test my rule"
              : `Recheck ${plainLanguage(attackTarget.label)}`}
        </button>
        <button
          className="arena__secondary"
          type="button"
          onClick={() =>
            onLoadTrace(recordedMuseActions, recordedEvidence, {
              label: "recorded starting policy",
              policy: startingPolicy,
              sourceText: startingPolicySourceText,
            })
          }
        >
          Load recorded case
        </button>
        <details className="commerce__technical commerce__technical--dark arena__details">
          <summary>Show current evidence and limits</summary>
          <section className="arena__loaded-evidence" aria-label="Current evidence and limits">
            <strong>{plainLanguage(evidence.verdict)}</strong>
            <p>{plainLanguage(evidence.summary)}</p>
            <p className="arena__target">Next test: {plainLanguage(attackTarget.label)}</p>
            {/* shortcut: mirrors fixed server limits; expose them from /api/health if they become configurable. */}
            <p>Search budget: up to 12 requests · 4 trials · 120 ticks per trial · 2 minutes.</p>
            {connection !== "ready" && (
              <p className={`arena__status arena__status--${connection}`} role="status">
                {connection === "checking" ? "Checking Meta connection" : isStaticDemo ? "Recorded demo" : "Offline replay mode"}
              </p>
            )}
          </section>
        </details>
      </div>
      {regressions.length > 0 && (
        <details className="commerce__technical commerce__technical--dark arena__wide-details">
          <summary>Show saved checks</summary>
          <section className="arena__regressions" aria-label="Saved checks">
            <div>
              <h3>Saved checks</h3>
              <p>Replayed automatically against {plainLanguage(attackTarget.label)}.</p>
            </div>
            <ul>
              {regressions.map((regression) => (
                <li className={regression.blocked ? "is-pass" : "is-fail"} key={regression.id}>
                  <b>{regression.blocked ? "Passed" : "Still pays"}</b>
                  <span>{plainLanguage(regression.label)}</span>
                  <small>
                    Expected {regression.expectedExcessReward} extra · now {regression.current.excessReward}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        </details>
      )}
      {strategies.length > 0 && (
        <details className="commerce__technical commerce__technical--dark arena__wide-details">
          <summary>Show Muse test activity</summary>
          <div className="arena__activity" aria-live="polite">
            {strategies.map((strategy, index) => (
              <p key={`${index}-${strategy}`}><b>Turn {index + 1}</b> {plainLanguage(strategy)}</p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
