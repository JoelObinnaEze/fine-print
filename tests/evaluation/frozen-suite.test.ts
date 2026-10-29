import { describe, expect, it } from "vitest";

import {
  evaluateFrozenCase,
  frozenEvaluationSuite,
  frozenModelInputs,
  frozenSuiteHash,
  interpretationSuite,
} from "../../scripts/frozen-evaluation-suite.js";

describe("frozen evaluation suite", () => {
  it("freezes six genuine failure/control pairs with complete inspectable metadata", () => {
    expect(frozenEvaluationSuite.version).toBe("fine-print-eval-v3");
    expect(frozenEvaluationSuite.cases).toHaveLength(12);
    expect(frozenEvaluationSuite.cases.filter((item) => item.expected === "flawed")).toHaveLength(6);
    expect(frozenEvaluationSuite.cases.filter((item) => item.expected === "blocked")).toHaveLength(6);
    expect(new Set(frozenEvaluationSuite.cases.map((item) => item.mechanism))).toHaveLength(6);
    expect(frozenSuiteHash).toMatch(/^[a-f0-9]{64}$/);
    for (const item of frozenEvaluationSuite.cases) {
      expect(item.intendedOutcome.length).toBeGreaterThan(10);
      expect(item.protectedLegitimateBehavior.length).toBeGreaterThan(10);
      expect(item.referenceActions.length).toBeGreaterThan(0);
      expect(item.initialState).toBeTruthy();
    }
  });

  it("replays every reference trace to its expected classification and preserves honest behavior", () => {
    for (const item of frozenEvaluationSuite.cases) {
      const result = evaluateFrozenCase(item);
      expect(result.actualClassification, item.id).toBe(item.expected);
      expect(result.protectedBehaviorPreserved, item.id).toBe(true);
      expect(result.deterministicReplayAgreement, item.id).toBe(true);
    }
  });

  it("keeps expected labels and reference traces out of model inputs", () => {
    expect(frozenModelInputs).toHaveLength(12);
    for (const input of frozenModelInputs) {
      expect(input).not.toHaveProperty("expected");
      expect(input).not.toHaveProperty("referenceActions");
      expect(input).not.toHaveProperty("referenceResult");
    }
  });

  it("scores interpretation separately and includes clarification and rejection cases", () => {
    expect(interpretationSuite.some((item) => item.expectedDisposition === "clarify")).toBe(true);
    expect(interpretationSuite.some((item) => item.expectedDisposition === "unsupported")).toBe(true);
    expect(interpretationSuite.some((item) => "refundHandling" in item.expectedFields)).toBe(true);
    expect(interpretationSuite.some((item) => "materials" in item.expectedFields)).toBe(true);
    expect(interpretationSuite.some((item) => "repetition" in item.expectedFields)).toBe(true);
  });
});
