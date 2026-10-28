import type { Policy } from "../packages/policy/src/schema.js";
import { createBottleReturnState } from "../packages/engine/src/scenario.js";
import { createHonestWorkerActions } from "../packages/evaluation/src/honest-worker.js";
import {
  batchHonestSixActions,
  patchPolicies,
} from "../apps/web/src/replay-data.js";

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

const standardHonestActions = createHonestWorkerActions(createBottleReturnState());

export const discoverySuite = [
  {
    id: "eligible-deposit-premature",
    expected: "flawed",
    policy: eligibleDeposit,
    honestActions: standardHonestActions,
    expectedHonestReward: 60,
  },
  {
    id: "eligible-processing-receipt",
    expected: "blocked",
    policy: eligibleProcessing,
    honestActions: standardHonestActions,
    expectedHonestReward: 60,
  },
  {
    id: "hopper-count-batch",
    expected: "flawed",
    policy: patchPolicies.batchVulnerable,
    honestActions: batchHonestSixActions,
    expectedHonestReward: 70,
  },
  {
    id: "processed-receipt-batch",
    expected: "blocked",
    policy: patchPolicies.batchReceipt,
    honestActions: batchHonestSixActions,
    expectedHonestReward: 70,
  },
] as const;

export const discoveryBaseline = {
  seeds: [17, 29, 43],
  maxExpandedStates: 30_000,
  maxActions: 40,
  beamWidth: 256,
} as const;
