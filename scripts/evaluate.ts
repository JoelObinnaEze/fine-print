import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyRunExport, type RunExport } from "../apps/server/src/runs/export.js";
import {
  canonicalHash,
  createBottleReturnState,
  ENGINE_VERSION,
  type Action,
} from "../packages/engine/src/index.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { runSimpleActionSearch } from "../apps/server/src/runs/baseline.js";
import type { LiveAttackResult } from "../apps/server/src/runs/live-attack-service.js";
import {
  calculateCompletedMetrics,
  calculateTestedPolicyScore,
  createHonestWorkerActions,
  hashReplay,
  replayActions,
} from "../packages/evaluation/src/index.js";
import type { Policy, PolicyClause } from "../packages/policy/src/index.js";
import { discoveryBaseline, discoverySuite } from "./discovery-suite.js";

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

interface SearchResultRow {
  readonly id: string;
  readonly status: string;
  readonly result_json: string;
}

const databasePath = resolve("fine-print.db");
const persistedSearches = new Map<string, readonly SearchResultRow[]>();
if (existsSync(databasePath)) {
  const database = openDatabase(databasePath);
  try {
    for (const benchmark of discoverySuite) {
      const policyHash = canonicalHash(benchmark.policy);
      persistedSearches.set(
        benchmark.id,
        database
          .prepare(`
            SELECT id, status, result_json
            FROM agent_searches
            WHERE policy_hash = ? AND result_json IS NOT NULL
            ORDER BY created_at, id
          `)
          .all(policyHash) as SearchResultRow[],
      );
    }
  } finally {
    database.close();
  }
}

const discoveryBenchmark = {
  status: "completed",
  frozenSuiteHash: canonicalHash(
    discoverySuite.map(({ id, expected, policy, expectedHonestReward }) => ({
      id,
      expected,
      policy,
      expectedHonestReward,
    })),
  ),
  baselineLimits: discoveryBaseline,
  museLimits: {
    maxInferenceRequests: 12,
    maxTrials: 4,
    maxTicksPerTrial: 120,
    searchDeadlineMs: 120_000,
  },
  policies: discoverySuite.map((benchmark) => {
    const baselineAttempts = discoveryBaseline.seeds.map((seed) => {
      const result = runSimpleActionSearch(initialState, benchmark.policy, {
        seed,
        maxExpandedStates: discoveryBaseline.maxExpandedStates,
        maxActions: discoveryBaseline.maxActions,
        beamWidth: discoveryBaseline.beamWidth,
      });
      return {
        seed,
        status: result.status,
        expandedStates: result.expandedStates,
        actionsToFirstExploit: result.actionsToFirstExploit,
        verifiedExcessReward: result.verification.excessReward,
        rejectedClaims: result.rejectedClaims,
      };
    });
    const museAttempts = (persistedSearches.get(benchmark.id) ?? []).map((row) => {
      const result = JSON.parse(row.result_json) as LiveAttackResult;
      return {
        searchId: row.id,
        runId: result.runId,
        persistedStatus: row.status,
        outcome: result.report.outcome,
        reason: result.report.reason,
        requestsUsed: result.report.requestsUsed,
        trialsCompleted: result.report.trialsCompleted,
        actionsTested: result.report.actionsTested,
        verificationStatus: result.verification.status,
        totalReward: result.verification.totalReward,
        usefulItems: result.verification.usefulItems,
        verifiedExcessReward: result.verification.excessReward,
        actualUsd: result.usage.actualUsd,
      };
    });
    const honestReplay = replayActions(initialState, benchmark.honestActions, benchmark.policy);
    return {
      id: benchmark.id,
      expected: benchmark.expected,
      policyHash: canonicalHash(benchmark.policy),
      honestReward: {
        expected: benchmark.expectedHonestReward,
        actual: honestReplay.state.rewardLedger.totalPoints,
        usefulItems: honestReplay.state.outcomeLedger.processedEligibleItemIds.length,
        preserved: honestReplay.state.rewardLedger.totalPoints === benchmark.expectedHonestReward,
      },
      simpleActionSearch: {
        verifiedExploitsFound: baselineAttempts.filter(({ status }) => status === "exploit_verified").length,
        repeatedRuns: baselineAttempts.length,
        rejectedClaims: baselineAttempts.reduce((total, attempt) => total + attempt.rejectedClaims, 0),
        attempts: baselineAttempts,
      },
      muse: {
        status: museAttempts.length > 0 ? "completed" : "not_run",
        verifiedExploitsFound: museAttempts.filter(({ outcome }) => outcome === "verified_exploit").length,
        repeatedRuns: museAttempts.length,
        rejectedClaims: museAttempts.filter(({ outcome }) => outcome === "candidate_rejected").length,
        attempts: museAttempts,
      },
    };
  }),
};

const report = {
  schemaVersion: 1,
  status: "completed",
  engineVersion: ENGINE_VERSION,
  scenario: { seed: initialState.seed, eligibleItems: 6, totalItems: 8 },
  offlineUsage: { inferenceRequests: 0, providerCostUsd: 0 },
  policyResults,
  liveEvidence,
  discoveryBenchmark,
  usabilityStudy: { status: "not_run", participants: 0 },
};

const outputPath = resolve("artifacts/evaluation.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(outputPath);
