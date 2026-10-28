import { useEffect, useState } from "react";

import { parseAction, type Action } from "../../../../packages/engine/src/actions.js";
import type { Policy } from "../../../../packages/policy/src/index.js";
import {
  recordedMuseActions,
  startingPolicy,
  startingPolicySourceText,
} from "../replay-data.js";
import { PolicyComposer } from "./PolicyComposer.js";

export interface RunEvidence {
  readonly provenance: "scripted_fixture" | "recorded_model_replay" | "live_model";
  readonly modelId: string | null;
  readonly requests: number;
  readonly totalTokens: number;
  readonly actualUsd: number;
  readonly runId: string | null;
  readonly verdict: string;
  readonly summary: string;
}

export interface AttackTarget {
  readonly label: string;
  readonly policy: Policy;
  readonly sourceText: string;
}

interface AttackAttempt {
  readonly status: "running" | "verified" | "inconclusive";
  readonly target: string;
  readonly detail: string;
}

export const scriptedEvidence: RunEvidence = {
  provenance: "scripted_fixture",
  modelId: null,
  requests: 0,
  totalTokens: 0,
  actualUsd: 0,
  runId: null,
  verdict: "Deterministic teaching trace",
  summary: "A known repeated-deposit loophole demonstrates the audit workflow without inference.",
};

const recordedEvidence: RunEvidence = {
  provenance: "recorded_model_replay",
  modelId: "muse-spark-1.3",
  requests: 10,
  totalTokens: 50_120,
  actualUsd: 0.070258,
  runId: "74e918a0-786b-4046-b415-9de2e665a6df",
  verdict: "Exploit independently verified",
  summary: "Muse found a 30-point trace with zero useful recycling; the host preserved two rejected actions.",
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
  const [availableBudget, setAvailableBudget] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [attempt, setAttempt] = useState<AttackAttempt | null>(null);
  const [strategies, setStrategies] = useState<readonly string[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/health"), fetch("/api/usage")])
      .then(async ([healthResponse, usageResponse]) => {
        if (!healthResponse.ok || !usageResponse.ok) throw new Error("Server unavailable.");
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
      };
      if (!response.ok || !result.runId || !result.verification || !result.usage) {
        throw new Error(result.error?.message ?? "The live search did not return a verified trace.");
      }
      const exportResponse = await fetch(`/api/runs/${result.runId}/export`);
      if (!exportResponse.ok) throw new Error("The verified replay export was unavailable.");
      const exported = (await exportResponse.json()) as { readonly actions?: readonly unknown[] };
      if (!Array.isArray(exported.actions)) throw new Error("The replay export was invalid.");
      const actions = exported.actions.map(parseAction);
      const strategySummaries = (result.turns ?? [])
        .map((turn) => turn.strategySummary?.trim())
        .filter((summary): summary is string => Boolean(summary));
      setStrategies(strategySummaries);
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
              ? "Exploit independently verified"
              : "Bounded search completed",
          summary: `${result.verification.totalReward ?? 0} reward points versus ${result.verification.usefulItems ?? 0} useful items.`,
        },
        attackTarget,
      );
      setAttempt({
        status: "verified",
        target: attackTarget.label,
        detail: "The exact model trace is loaded below. Every reward was recomputed by the host.",
      });
    } catch (error) {
      setAttempt({
        status: "inconclusive",
        target: attackTarget.label,
        detail: error instanceof Error ? error.message : "The live attack failed.",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="arena" aria-labelledby="arena-title">
      <div className="arena__intro">
        <p className="eyebrow">Fine Print · red-team arena</p>
        <h2 id="arena-title">Can you earn rewards without recycling anything?</h2>
        <p className="arena__result">30 points paid. 0 items recycled.</p>
        <p>
          The starting rule rewards deposits before recycling is proven. Patch it, then send Muse
          back in and let the host verify every claimed exploit.
        </p>
      </div>

      <ol className="arena__steps" aria-label="Audit workflow">
        <li><b>01</b><span>Write a policy</span></li>
        <li><b>02</b><span>Muse attacks</span></li>
        <li><b>03</b><span>Host verifies</span></li>
        <li><b>04</b><span>Patch & replay</span></li>
      </ol>

      <PolicyComposer
        connection={connection}
        sourceText={activeSourceText}
        onActivate={onActivatePolicy}
      />

      <div className="arena__proof">
        {attempt && (
          <div
            aria-label="Latest live attempt"
            className={`arena__attempt arena__attempt--${attempt.status}`}
            role="status"
          >
            <p className="eyebrow">Latest live attempt</p>
            <strong>
              {attempt.status === "running"
                ? "Search in progress"
                : attempt.status === "verified"
                  ? "Verified trace loaded"
                  : "Inconclusive — no verified trace"}
            </strong>
            <dl>
              <div><dt>Target</dt><dd>{attempt.target}</dd></div>
              <div><dt>Provenance</dt><dd>Live Meta search</dd></div>
            </dl>
            <p>{attempt.detail}</p>
          </div>
        )}
        <section className="arena__loaded-evidence" aria-label="Loaded replay evidence">
          <p className="eyebrow">Loaded replay evidence</p>
          <strong>{evidence.verdict}</strong>
          <p>{evidence.summary}</p>
          <p className="arena__target">Next search: {attackTarget.label}</p>
          {/* shortcut: mirrors fixed server limits; expose them from /api/health if they become configurable. */}
          <p>Search budget: up to 12 requests · 4 trials · 120 ticks per trial · 2 minutes.</p>
          <p className={`arena__status arena__status--${connection}`} role="status">
            {connection === "ready"
              ? "Meta connected"
              : connection === "checking"
                ? "Checking Meta connection"
                : "Offline replay mode"}
            {availableBudget !== null ? ` · $${availableBudget.toFixed(2)} budget left` : ""}
          </p>
        </section>
        <button
          className="arena__primary"
          type="button"
          disabled={connection !== "ready" || isRunning}
          onClick={() => void runLiveAttack()}
        >
          {isRunning
            ? `Muse is attacking ${attackTarget.label}…`
            : attackTarget.label === "active policy"
              ? "Run fresh Muse attack"
              : `Fresh-attack ${attackTarget.label}`}
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
          Load recorded starting-policy run
        </button>
      </div>
      {strategies.length > 0 && (
        <div className="arena__activity" aria-live="polite">
          {strategies.map((strategy, index) => (
            <p key={`${index}-${strategy}`}><b>Turn {index + 1}</b> {strategy}</p>
          ))}
        </div>
      )}
    </section>
  );
}
