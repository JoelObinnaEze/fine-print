import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyRunExport, type RunExport } from "../apps/server/src/runs/export.js";
import {
  createBottleReturnState,
  ENGINE_VERSION,
  type Action,
} from "../packages/engine/src/index.js";
import {
  calculateCompletedMetrics,
  calculateTestedPolicyScore,
  createHonestWorkerActions,
  hashReplay,
  replayActions,
} from "../packages/evaluation/src/index.js";
import type { Policy, PolicyClause } from "../packages/policy/src/index.js";

const initialState = createBottleReturnState();
const depositClause: PolicyClause = {
  id: "deposit-payout",
  enabled: true,
  trigger: "deposit" as const,
  points: 10,
  eligibleOnly: false,
  materials: ["plastic", "aluminium", "carton", "rubbish"],
  repetition: "every_event",
};
const policies: Readonly<Record<string, Policy>> = {
  noRewards: { schemaVersion: 1, clauses: [] },
  everyDeposit: { schemaVersion: 1, clauses: [depositClause] },
  oncePerItemDeposit: {
    schemaVersion: 1,
    clauses: [{ ...depositClause, repetition: "once_per_item" }],
  },
  eligibleProcessing: {
    schemaVersion: 1,
    clauses: [
      {
        ...depositClause,
        id: "eligible-processing",
        trigger: "process",
        eligibleOnly: true,
        materials: ["plastic", "aluminium"],
        repetition: "once_per_item",
      },
    ],
  },
};

const repeatedDeposit: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "B1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
  { type: "finish" },
];
const contamination: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "R1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
  { type: "move", direction: "down" },
  { type: "move", direction: "right" },
  { type: "process", itemId: "R1" },
  { type: "finish" },
];
const traces = { repeatedDeposit, contamination } as const;
const honestOrders = [
  ["B1", "B2", "B3", "C1", "C2", "C3"],
  ["C3", "C2", "C1", "B3", "B2", "B1"],
  ["B1", "C1", "B2", "C2", "B3", "C3"],
] as const;

function metricsFor(actions: readonly Action[], policy: Policy) {
  const replay = replayActions(initialState, actions, policy);
  const replayHash = hashReplay(replay);
  return {
    actions: actions.length,
    ...calculateCompletedMetrics(initialState, replay),
    replayHash,
    deterministicReplayAgreement:
      replayHash === hashReplay(replayActions(initialState, actions, policy)),
  };
}

const policyResults = Object.entries(policies).map(([id, policy]) => {
  const honest = honestOrders.map((order) =>
    metricsFor(createHonestWorkerActions(initialState, order), policy),
  );
  const adversarial = Object.fromEntries(
    Object.entries(traces).map(([traceId, actions]) => [traceId, metricsFor(actions, policy)]),
  );
  const minimumCoverage = Math.min(...honest.map((result) => result.legitimateCoverage));
  const maximumLeakage = Math.max(
    ...Object.values(adversarial).map((result) => result.leakage),
  );
  return {
    id,
    honestCoverage: {
      passingItems: minimumCoverage * 6,
      eligibleItems: 6,
      minimumCoverage,
      ordersTested: honest.length,
    },
    maximumObservedLeakage: maximumLeakage,
    adversarialTracesTested: Object.keys(adversarial).length,
    testedPolicyScore: calculateTestedPolicyScore(minimumCoverage, maximumLeakage),
    honest,
    adversarial,
  };
});

const livePath = resolve("artifacts/attacker-live-v2.json");
let liveEvidence: unknown = { status: "not_run", reason: "Live export artifact is absent." };
if (existsSync(livePath)) {
  const exported = JSON.parse(readFileSync(livePath, "utf8")) as RunExport;
  const replay = verifyRunExport(exported);
  liveEvidence = {
    status: "completed",
    provenance: exported.provenance,
    modelId: exported.modelId,
    limits: exported.limits,
    usage: exported.usage,
    verifiedActionCount: exported.actions.length,
    ...calculateCompletedMetrics(initialState, {
      ...replay,
      state: replay.state.terminal
        ? replay.state
        : replayActions(replay.state, [{ type: "finish" }], exported.policy).state,
    }),
    replayHash: exported.replayHash,
  };
}

const report = {
  schemaVersion: 1,
  status: "completed",
  engineVersion: ENGINE_VERSION,
  scenario: { seed: initialState.seed, eligibleItems: 6, totalItems: 8 },
  offlineUsage: { inferenceRequests: 0, providerCostUsd: 0 },
  policyResults,
  liveEvidence,
  usabilityStudy: { status: "not_run", participants: 0 },
};

const outputPath = resolve("artifacts/evaluation.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(outputPath);
