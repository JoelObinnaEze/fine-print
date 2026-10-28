import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createRunServer } from "../../apps/server/src/app.js";
import { BudgetService } from "../../apps/server/src/budget/service.js";
import { readServerConfig } from "../../apps/server/src/config.js";
import { openDatabase } from "../../apps/server/src/persistence/database.js";
import type { MetaAttackerTurnRecord } from "../../apps/server/src/providers/meta-attacker.js";
import type {
  AttackerProvider,
  AttackerProviderInput,
  AttackerTurn,
} from "../../apps/server/src/runs/agent.js";
import { LiveAttackService } from "../../apps/server/src/runs/live-attack-service.js";
import { RunService } from "../../apps/server/src/runs/service.js";
import type { Policy } from "../../packages/policy/src/index.js";

const policy: Policy = {
  schemaVersion: 1,
  clauses: [
    {
      id: "deposit-payout",
      enabled: true,
      trigger: "deposit",
      points: 10,
      eligibleOnly: false,
      materials: ["plastic", "aluminium", "carton", "rubbish"],
      repetition: "every_event",
    },
  ],
};

const exploitActions = [
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
] as const;

class FixtureProvider implements AttackerProvider {
  readonly turns: MetaAttackerTurnRecord[] = [];
  calls = 0;

  async next(input: AttackerProviderInput): Promise<AttackerTurn> {
    this.calls += 1;
    const toolCall = {
      id: "submit-fixture",
      name: "submit_candidate",
      arguments: {
        actions: exploitActions,
        summary: "Repeated deposits paid without recycling.",
        evidenceEventIds: [7, 9, 11],
      },
    } as const;
    this.turns.push({
      sequence: input.requestNumber,
      strategySummary: "Test whether one bottle can earn repeatedly.",
      toolCalls: [toolCall],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        actualUsd: 0.000338,
      },
    });
    return { strategySummary: this.turns[0]!.strategySummary, toolCalls: [toolCall] };
  }
}

class SingleTurnProvider implements AttackerProvider {
  readonly turns: MetaAttackerTurnRecord[] = [];

  constructor(
    private readonly strategySummary: string,
    private readonly toolCall: MetaAttackerTurnRecord["toolCalls"][number] | null,
  ) {}

  async next(input: AttackerProviderInput): Promise<AttackerTurn> {
    const toolCalls = this.toolCall ? [this.toolCall] : [];
    this.turns.push({
      sequence: input.requestNumber,
      strategySummary: this.strategySummary,
      toolCalls,
      usage: {
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
        actualUsd: 0.0001,
      },
    });
    return { strategySummary: this.strategySummary, toolCalls };
  }
}

class InterruptedProvider implements AttackerProvider {
  readonly turns: MetaAttackerTurnRecord[] = [];

  async next(): Promise<AttackerTurn> {
    throw new Error("fixture provider unavailable");
  }
}

const databases = [] as ReturnType<typeof openDatabase>[];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const database of databases.splice(0)) database.close();
});

function createServices(provider: AttackerProvider & { readonly turns: readonly MetaAttackerTurnRecord[] }) {
  const database = openDatabase(":memory:");
  databases.push(database);
  const config = readServerConfig({
    MODEL_API_KEY: "test-secret",
    META_BASE_URL: "https://api.meta.ai/v1",
    META_MODEL_ID: "muse-spark-1.3",
    EVENT_CREDITS_CONFIRMED: "true",
    EVENT_CREDITS_REMAINING_USD: "10",
    APP_BUDGET_USD: "10",
    SESSION_BUDGET_USD: "2",
    SEARCH_BUDGET_USD: "0.25",
    LIVE_AGENT_ENABLED: "true",
    MAX_CONCURRENT_PROVIDER_REQUESTS: "1",
  });
  const runs = new RunService(database);
  const budget = new BudgetService(database, config, "browser-tests");
  const attacks = new LiveAttackService(database, runs, config, budget, () => provider);
  return { attacks, budget, config, runs };
}

describe("live browser attack lifecycle", () => {
  it("persists a verified Muse trace and safely replays a duplicate intent", async () => {
    const provider = new FixtureProvider();
    const { attacks, runs } = createServices(provider);

    const first = await attacks.run(policy, "browser-attack-1");

    expect(first).toMatchObject({
      searchId: "browser-attack-1",
      provenance: "live_model",
      modelId: "muse-spark-1.3",
      replayed: false,
      verification: {
        status: "exploit_verified",
        totalReward: 30,
        usefulItems: 0,
        requestsUsed: 1,
      },
      turns: [
        {
          sequence: 1,
          strategySummary: "Test whether one bottle can earn repeatedly.",
          toolNames: ["submit_candidate"],
        },
      ],
      usage: { requests: 1, totalTokens: 150, actualUsd: 0.000338 },
      report: {
        outcome: "verified_exploit",
        requestsUsed: 1,
        trialsCompleted: 1,
        actionsTested: exploitActions.length,
      },
    });
    expect(first.runId).toEqual(expect.any(String));
    expect(runs.get(first.runId!)).toMatchObject({
      status: "completed",
      provenance: "live_model",
      modelId: "muse-spark-1.3",
      state: { rewardLedger: { totalPoints: 30 } },
    });

    const replayed = await attacks.run(policy, "browser-attack-1");

    expect(replayed).toEqual({ ...first, replayed: true });
    expect(provider.calls).toBe(1);
  });

  it.each([
    {
      name: "completed search",
      provider: () =>
        new SingleTurnProvider("No exploit found in the bounded search.", {
          id: "conclude",
          name: "conclude_no_exploit",
          arguments: { summary: "No exploit found within this budget." },
        }),
      outcome: "search_completed",
      status: "no_exploit_found_within_budget",
      actionsTested: 0,
      reason: /no exploit was found within/i,
    },
    {
      name: "rejected candidate",
      provider: () =>
        new SingleTurnProvider("Submit a harmless candidate for host verification.", {
          id: "submit",
          name: "submit_candidate",
          arguments: {
            actions: [{ type: "finish" }],
            summary: "This trace should not earn a reward.",
            evidenceEventIds: [],
          },
        }),
      outcome: "candidate_rejected",
      status: "no_exploit_in_submitted_trace",
      actionsTested: 1,
      reason: /host replay found 0 unintended reward points/i,
    },
    {
      name: "interrupted search",
      provider: () => new InterruptedProvider(),
      outcome: "search_interrupted",
      status: "run_incomplete",
      actionsTested: 0,
      reason: /provider request failed/i,
    },
  ])("returns a durable report for a $name", async ({ provider, outcome, status, actionsTested, reason }) => {
    const { attacks } = createServices(provider());

    const result = await attacks.run(policy, `report-${outcome}`);

    expect(result.verification.status).toBe(status);
    expect(result.report).toMatchObject({
      outcome,
      requestsUsed: 1,
      trialsCompleted: 1,
      actionsTested,
    });
    expect(result.report.reason).toMatch(reason);
    if (outcome === "candidate_rejected") {
      expect(result.report.attemptedTraces).toEqual([
        expect.objectContaining({
          request: 1,
          trial: 1,
          kind: "candidate",
          hypothesis: "Submit a harmless candidate for host verification.",
          actions: [{ type: "finish" }],
        }),
      ]);
    }

    await expect(attacks.run(policy, `report-${outcome}`)).resolves.toEqual({
      ...result,
      replayed: true,
    });
  });

  it("rejects an idempotency key reused for another policy", async () => {
    const provider = new FixtureProvider();
    const { attacks } = createServices(provider);
    await attacks.run(policy, "browser-attack-conflict");

    await expect(
      attacks.run({ ...policy, clauses: [] }, "browser-attack-conflict"),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(provider.calls).toBe(1);
  });

  it("exposes the verified lifecycle through the local HTTP API", async () => {
    const provider = new FixtureProvider();
    const { attacks, budget, config, runs } = createServices(provider);
    const server = createRunServer(runs, { config, budget, attacks });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const missingKey = await fetch(`${baseUrl}/api/attacks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    expect(missingKey.status).toBe(400);

    const response = await fetch(`${baseUrl}/api/attacks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "browser-route-1",
      },
      body: JSON.stringify({ policy }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      searchId: "browser-route-1",
      modelId: "muse-spark-1.3",
      verification: { status: "exploit_verified", totalReward: 30 },
    });
  });
});
