import { describe, expect, it } from "vitest";

import { evaluatePolicyGauntlet } from "../../apps/web/src/policy/PolicyGauntlet.js";
import type { Policy } from "../../packages/policy/src/index.js";
import {
  patchPolicies,
  startingPolicy,
} from "../../apps/web/src/replay-data.js";

describe("policy gauntlet evidence", () => {
  it("shows the once-per-item patch closes only the duplicate-payout failure", () => {
    const original = evaluatePolicyGauntlet(startingPolicy);
    const firstPatch = evaluatePolicyGauntlet(patchPolicies.oncePerItem);

    expect(original.honestWorkflows).toMatchObject({ passed: 3, total: 3 });
    expect(original.attacks.map(({ blocked, observedReward }) => ({ blocked, observedReward })))
      .toEqual([
        { blocked: false, observedReward: 30 },
        { blocked: false, observedReward: 10 },
        { blocked: false, observedReward: 10 },
      ]);
    expect(firstPatch.honestWorkflows).toMatchObject({ passed: 3, total: 3 });
    expect(firstPatch.attacks.map(({ blocked }) => blocked)).toEqual([true, false, false]);
  });

  it("shows eligible processing preserves honest work and blocks all known failures", () => {
    const strongPatch = evaluatePolicyGauntlet(patchPolicies.eligibleProcessing);

    expect(strongPatch.honestWorkflows).toMatchObject({ passed: 3, total: 3 });
    expect(strongPatch.honestWorkflows.results).toEqual([
      { name: "Input order", expectedReward: 60, actualReward: 60, passed: true },
      { name: "Reverse order", expectedReward: 60, actualReward: 60, passed: true },
      { name: "Alternating order", expectedReward: 60, actualReward: 60, passed: true },
    ]);
    expect(strongPatch.attacks.map(({ blocked, observedReward }) => ({ blocked, observedReward })))
      .toEqual([
        { blocked: true, observedReward: 0 },
        { blocked: true, observedReward: 0 },
        { blocked: true, observedReward: 0 },
      ]);
  });

  it("reports reference and actual payouts for a deliberately narrower policy", () => {
    const aluminiumPolicy: Policy = {
      schemaVersion: 1,
      clauses: [
        {
          id: "aluminium-processing",
          enabled: true,
          trigger: "process",
          points: 7,
          eligibleOnly: false,
          materials: ["aluminium"],
          repetition: "once_per_item",
        },
      ],
    };

    const result = evaluatePolicyGauntlet(aluminiumPolicy);

    expect(result.honestWorkflows).toMatchObject({ passed: 0, total: 3 });
    expect(result.honestWorkflows.results.map(({ expectedReward, actualReward, passed }) => ({
      expectedReward,
      actualReward,
      passed,
    }))).toEqual([
      { expectedReward: 60, actualReward: 21, passed: false },
      { expectedReward: 60, actualReward: 21, passed: false },
      { expectedReward: 60, actualReward: 21, passed: false },
    ]);
  });
});
