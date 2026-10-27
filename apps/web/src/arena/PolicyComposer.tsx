import { useState } from "react";

import {
  parsePolicyInterpretation,
  type Policy,
  type PolicyInterpretation,
} from "../../../../packages/policy/src/index.js";

export function PolicyComposer({
  connection,
  sourceText,
  onActivate,
}: {
  readonly connection: "checking" | "ready" | "offline";
  readonly sourceText: string;
  readonly onActivate: (policy: Policy, sourceText: string) => void;
}) {
  const [draft, setDraft] = useState(sourceText);
  const [interpretation, setInterpretation] = useState<PolicyInterpretation | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const interpret = async () => {
    const text = draft.trim();
    if (!text) return;
    setIsTranslating(true);
    setInterpretation(null);
    setMessage("Meta is compiling your rule into the bounded policy language…");
    try {
      const response = await fetch("/api/policies/translate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `translation-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ text }),
      });
      const result = (await response.json()) as {
        readonly error?: { readonly message?: string };
        readonly interpretation?: unknown;
      };
      if (!response.ok || !result.interpretation) {
        throw new Error(result.error?.message ?? "Meta did not return a policy interpretation.");
      }
      const nextInterpretation = parsePolicyInterpretation(result.interpretation);
      setInterpretation(nextInterpretation);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Policy interpretation failed.");
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <section className="arena__composer" aria-labelledby="composer-title">
      <div>
        <p className="eyebrow">Policy compiler</p>
        <h3 id="composer-title">Write the incentive in plain English</h3>
      </div>
      <label>
        <span>Reward policy</span>
        <textarea
          value={draft}
          maxLength={2_000}
          rows={3}
          onChange={(event) => {
            setDraft(event.target.value);
            setInterpretation(null);
          }}
        />
      </label>
      <div className="arena__composer-actions">
        <button
          className="arena__primary"
          type="button"
          disabled={connection !== "ready" || isTranslating || draft.trim().length === 0}
          onClick={() => void interpret()}
        >
          {isTranslating ? "Interpreting…" : "Interpret with Meta"}
        </button>
        {interpretation?.status === "candidate" && (
          <button
            className="arena__secondary"
            type="button"
            onClick={() => onActivate(interpretation.policy, draft.trim())}
          >
            Activate candidate
          </button>
        )}
      </div>
      {(message || interpretation) && (
        <div className="arena__candidate" aria-live="polite">
          <strong>
            {interpretation
              ? interpretation.status === "candidate"
                ? "Candidate ready for review"
                : "Needs clarification"
              : "Interpreting policy"}
          </strong>
          <p>{interpretation?.reason ?? message}</p>
          {interpretation?.status === "candidate" && interpretation.policy.clauses[0] && (
            <p>
              {interpretation.policy.clauses[0].points} points · {interpretation.policy.clauses[0].trigger} · {interpretation.policy.clauses[0].repetition.replaceAll("_", " ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
