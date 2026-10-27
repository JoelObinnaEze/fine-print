import { describe, expect, it } from "vitest";

import { evaluatePolicyGauntlet } from "../../apps/web/src/policy/PolicyGauntlet.js";
import {
  patchPolicies,
  startingPolicy,
} from "../../apps/web/src/replay-data.js";

describe("policy gauntlet evidence", () => {
  it("shows the once-per-item patch closes only the duplicate-payout failure", () => {
    const original = evaluatePolicyGauntlet(startingPolicy);
    const firstPatch = evaluatePolicyGauntlet(patchPolicies.oncePerItem);

    expect(original.honestWorkflows).toEqual({ passed: 3, total: 3 });
    expect(original.attacks.map(({ blocked, observedReward }) => ({ blocked, observedReward })))
      .toEqual([
        { blocked: false, observedReward: 30 },
        { blocked: false, observedReward: 10 },
        { blocked: false, observedReward: 10 },
      ]);
    expect(firstPatch.honestWorkflows).toEqual({ passed: 3, total: 3 });
    expect(firstPatch.attacks.map(({ blocked }) => blocked)).toEqual([true, false, false]);
  });

  it("shows eligible processing preserves honest work and blocks all known failures", () => {
    const strongPatch = evaluatePolicyGauntlet(patchPolicies.eligibleProcessing);

    expect(strongPatch.honestWorkflows).toEqual({ passed: 3, total: 3 });
    expect(strongPatch.attacks.map(({ blocked, observedReward }) => ({ blocked, observedReward })))
      .toEqual([
        { blocked: true, observedReward: 0 },
        { blocked: true, observedReward: 0 },
        { blocked: true, observedReward: 0 },
      ]);
  });
});
