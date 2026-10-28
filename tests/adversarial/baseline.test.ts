import { describe, expect, it } from "vitest";

import { runSimpleActionSearch } from "../../apps/server/src/runs/baseline.js";
import { createBottleReturnState } from "../../packages/engine/src/scenario.js";
import type { Policy } from "../../packages/policy/src/schema.js";
import { patchPolicies } from "../../apps/web/src/replay-data.js";

const eligibleDeposit: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "eligible-deposit",
      enabled: true,
      trigger: "deposit",
      points: 10,
      eligibleOnly: true,
      materials: ["plastic", "aluminium"],
      repetition: "once_per_item",
    },
  ],
};

const eligibleProcessing: Policy = {
  ...eligibleDeposit,
  clauses: [{ ...eligibleDeposit.clauses[0]!, trigger: "process" }],
};

describe("simple action-search baseline", () => {
  it.each([
    ["premature eligible deposit", eligibleDeposit],
    ["transient hopper bonus", patchPolicies.batchVulnerable],
  ])("finds the disclosed %s failure within its fixed state budget", (_name, policy) => {
    const result = runSimpleActionSearch(createBottleReturnState(), policy, {
      seed: 17,
      maxExpandedStates: 30_000,
      maxActions: 40,
      beamWidth: 256,
    });

    expect(result.status).toBe("exploit_verified");
    expect(result.expandedStates).toBeLessThanOrEqual(30_000);
    expect(result.actions.length).toBeLessThanOrEqual(40);
    expect(result.verification.excessReward).toBeGreaterThan(0);
  });

  it.each([
    ["eligible processing", eligibleProcessing],
    ["receipt-backed batch", patchPolicies.batchReceipt],
  ])("does not claim an exploit against %s", (_name, policy) => {
    const result = runSimpleActionSearch(createBottleReturnState(), policy, {
      seed: 29,
      maxExpandedStates: 3_000,
      maxActions: 30,
      beamWidth: 96,
    });

    expect(result).toMatchObject({
      status: "no_exploit_found_within_budget",
      rejectedClaims: 0,
    });
  });

  it("is deterministic for a disclosed seed and budget", () => {
    const options = { seed: 43, maxExpandedStates: 2_000, maxActions: 24, beamWidth: 64 };
    const first = runSimpleActionSearch(createBottleReturnState(), eligibleDeposit, options);
    const second = runSimpleActionSearch(createBottleReturnState(), eligibleDeposit, options);
    expect(second).toEqual(first);
  });
});
