import { useEffect, useRef, useState } from "react";

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
  const requestVersion = useRef(0);
  const candidateClauses = interpretation?.status === "candidate"
    ? interpretation.policy.clauses
    : [];

  useEffect(() => {
    requestVersion.current += 1;
    setDraft(sourceText);
    setInterpretation(null);
    setMessage(null);
  }, [sourceText]);

  const interpret = async () => {
    const text = draft.trim();
    if (!text) return;
    const version = ++requestVersion.current;
    setIsTranslating(true);
    setInterpretation(null);
    setMessage("Muse is mapping your rule into the simulator…");
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
      if (requestVersion.current !== version) return;
      setInterpretation(nextInterpretation);
      setMessage(null);
    } catch (error) {
      if (requestVersion.current === version) {
        setMessage(error instanceof Error ? error.message : "Policy interpretation failed.");
      }
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <section className="arena__composer" aria-labelledby="composer-title">
      <h3 id="composer-title">Describe the reward rule</h3>
      <label>
        <span>Reward policy</span>
        <textarea
          value={draft}
          maxLength={2_000}
          rows={3}
          onChange={(event) => {
            requestVersion.current += 1;
            setDraft(event.target.value);
            setInterpretation(null);
            setMessage(null);
          }}
        />
      </label>
      <div className="arena__composer-actions">
        <button
          className="arena__secondary"
          type="button"
          disabled={connection !== "ready" || isTranslating || draft.trim().length === 0}
          onClick={() => void interpret()}
        >
          {isTranslating ? "Understanding…" : "Understand this rule"}
        </button>
        {interpretation?.status === "candidate" && (
          <button
            className="arena__primary"
            type="button"
            onClick={() => onActivate(interpretation.policy, draft.trim())}
          >
            Use this rule
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
          {candidateClauses.length > 0 && (
            <details className="commerce__technical commerce__technical--dark">
              <summary>Show technical rule mapping</summary>
              {candidateClauses.map((clause) => (
                <section className="arena__candidate-clause" key={clause.id}>
                  <b>{clause.id.replaceAll("-", " ")}</b>
                  <dl>
                    <div><dt>Reward trigger</dt><dd>{clause.trigger === "hopper_threshold" ? `hopper reaches ${clause.batchSize}` : clause.trigger === "processed_batch" ? `every ${clause.batchSize} processed receipts` : clause.trigger}</dd></div>
                    <div><dt>Paid materials</dt><dd>{clause.materials.join(", ")}</dd></div>
                    <div><dt>Eligibility required</dt><dd>{clause.eligibleOnly ? "Yes" : "No"}</dd></div>
                    <div><dt>Repeat limit</dt><dd>{clause.repetition === "once_per_item" ? "once per item" : "none"}</dd></div>
                    <div><dt>Successful processing required</dt><dd>{clause.trigger === "process" || clause.trigger === "processed_batch" ? "Yes" : "No"}</dd></div>
                  </dl>
                </section>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
