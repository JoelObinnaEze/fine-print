import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("evaluation artifact", () => {
  it("reports raw tested quantities, replay agreement, cost, and unrun work honestly", () => {
    const report = JSON.parse(readFileSync("artifacts/evaluation.json", "utf8")) as {
      readonly policyResults: readonly {
        readonly id: string;
        readonly testedPolicyScore: number;
        readonly adversarialTracesTested: number;
        readonly honest: readonly { readonly deterministicReplayAgreement: boolean }[];
        readonly adversarial: Readonly<Record<string, { readonly deterministicReplayAgreement: boolean }>>;
      }[];
      readonly liveEvidence: {
        readonly status: string;
        readonly usage: { readonly requests: number; readonly actualUsd: number };
      };
      readonly usabilityStudy: { readonly status: string; readonly participants: number };
    };

    expect(Object.fromEntries(report.policyResults.map((policy) => [policy.id, policy.testedPolicyScore]))).toEqual({
      noRewards: 0,
      everyDeposit: 50,
      oncePerItemDeposit: 83,
      eligibleProcessing: 100,
    });
    expect(report.policyResults.every((policy) => policy.adversarialTracesTested === 2)).toBe(true);
    expect(
      report.policyResults.every(
        (policy) =>
          policy.honest.every((trace) => trace.deterministicReplayAgreement) &&
          Object.values(policy.adversarial).every((trace) => trace.deterministicReplayAgreement),
      ),
    ).toBe(true);
    expect(report.liveEvidence).toMatchObject({
      status: "completed",
      usage: { requests: 10, actualUsd: 0.070258 },
    });
    expect(report.usabilityStudy).toEqual({ status: "not_run", participants: 0 });
  });
});
