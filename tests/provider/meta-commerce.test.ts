import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRunServer } from "../../apps/server/src/app.js";
import { BudgetService } from "../../apps/server/src/budget/service.js";
import { readServerConfig } from "../../apps/server/src/config.js";
import { openDatabase } from "../../apps/server/src/persistence/database.js";
import {
  MetaCommerceInvestigator,
  type CommerceInvestigationRequest,
} from "../../apps/server/src/providers/meta-commerce.js";
import { RunService } from "../../apps/server/src/runs/service.js";
import {
  commerceGoal,
  commerceRepairCandidates,
  refundAttackActions,
  vulnerableCommercePolicy,
} from "../../packages/commerce/src/index.js";

const databases = [] as ReturnType<typeof openDatabase>[];
const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

function environment() {
  return {
    MODEL_API_KEY: "test-secret",
    META_BASE_URL: "https://api.meta.ai/v1",
    META_MODEL_ID: "muse-spark-1.3",
    EVENT_CREDITS_CONFIRMED: "true",
    EVENT_CREDITS_REMAINING_USD: "10",
    APP_BUDGET_USD: "10",
    SESSION_BUDGET_USD: "2",
    SEARCH_BUDGET_USD: "0.25",
    META_INPUT_USD_PER_MILLION: "1.25",
    META_OUTPUT_USD_PER_MILLION: "4.25",
    LIVE_AGENT_ENABLED: "true",
    MAX_CONCURRENT_PROVIDER_REQUESTS: "1",
  };
}

const request: CommerceInvestigationRequest = {
  sourceText:
    "Give both people $10 credit when a referred customer completes a $20 purchase. Customers can return purchases within 30 days and issued credit remains after a refund.",
  goal: commerceGoal,
  restrictions: ["Keep a legitimate $10 reward for both people"],
};

const modelOutput = {
  status: "candidate",
  reason: "Mapped the referral, purchase, credit, return-window, and refund clauses.",
  policy: vulnerableCommercePolicy,
  supportedClauses: [
    "$10 to both accounts",
    "$20 gross purchase threshold",
    "30-day refund window",
    "credit remains after refund",
  ],
  unsupportedConditions: [],
  attackHypothesis:
    "A referred customer may qualify both accounts, then refund while the credit remains spendable.",
  attackActions: refundAttackActions,
  candidates: commerceRepairCandidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    tradeoff: candidate.tradeoff,
    complexity: candidate.complexity,
    policy: candidate.policy,
  })),
};

function completion(output: unknown) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-commerce",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(output) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 400, total_tokens: 900 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function createServices(fetchImplementation: typeof fetch) {
  const database = openDatabase(":memory:");
  databases.push(database);
  const config = readServerConfig(environment());
  const budget = new BudgetService(database, config, "commerce-tests");
  const commerce = new MetaCommerceInvestigator(
    database,
    config,
    budget,
    fetchImplementation,
  );
  return { budget, commerce, config, database };
}

describe("Meta commerce investigation", () => {
  it("validates Muse output, minimizes the trace, and host-tests every design", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.meta.ai/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "muse-spark-1.3",
        reasoning_effort: "low",
        response_format: { type: "json_schema", json_schema: { strict: false } },
      });
      expect(JSON.stringify(body)).toContain(request.sourceText);
      expect(JSON.stringify(body)).toContain(commerceGoal.description);
      return completion(modelOutput);
    });
    const { budget, commerce } = createServices(fetchMock);

    const first = await commerce.investigate(request, "commerce-1");
    const replayed = await commerce.investigate(request, "commerce-1");

    expect(first).toMatchObject({
      replayed: false,
      modelId: "muse-spark-1.3",
      mapping: {
        status: "candidate",
        policy: vulnerableCommercePolicy,
        unsupportedConditions: [],
      },
      attack: {
        hypothesis: modelOutput.attackHypothesis,
        proposedActionCount: 3,
        minimizedActions: refundAttackActions,
        verification: {
          status: "exploit_verified",
          unintendedPayoutUsd: 20,
          retainedRevenueUsd: 0,
        },
      },
      usage: { promptTokens: 500, completionTokens: 400, totalTokens: 900 },
    });
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates.every((candidate) => candidate.evaluation.knownAttackBlocked)).toBe(true);
    expect(first.candidates.every((candidate) => candidate.evaluation.honestRewardsPreserved)).toBe(true);
    expect(first.population!.aggregate).toMatchObject({
      participants: 6,
      verifiedUnintendedPayoutUsd: 20,
    });
    expect(replayed).toEqual({ ...first, replayed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.getUsage()).toMatchObject({ reservedUsd: 0, ambiguousUsd: 0 });
    expect(JSON.stringify(first)).not.toContain("test-secret");
  });

  it("surfaces unsupported conditions without inventing an executable mapping", async () => {
    const { commerce } = createServices(async () =>
      completion({
        status: "unsupported",
        reason: "The policy requires geography and device fingerprinting outside this simulator.",
        policy: null,
        supportedClauses: ["$10 reward"],
        unsupportedConditions: ["country eligibility", "device fingerprinting"],
        attackHypothesis: "",
        attackActions: [],
        candidates: [],
      }),
    );

    await expect(commerce.investigate(request, "commerce-unsupported")).resolves.toMatchObject({
      mapping: {
        status: "unsupported",
        policy: null,
        unsupportedConditions: ["country eligibility", "device fingerprinting"],
      },
      attack: null,
      candidates: [],
      population: null,
    });
  });

  it("rejects an idempotency key reused for another investigation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => completion(modelOutput));
    const { commerce } = createServices(fetchMock);
    await commerce.investigate(request, "commerce-conflict");

    await expect(
      commerce.investigate(
        { ...request, goal: { ...request.goal, minimumUsd: 30 } },
        "commerce-conflict",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes the investigation through the local HTTP API", async () => {
    const { budget, commerce, config, database } = createServices(async () => completion(modelOutput));
    const server = createRunServer(new RunService(database), { config, budget, commerce });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/commerce/investigations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "commerce-route-1",
      },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      mapping: { status: "candidate" },
      attack: { verification: { status: "exploit_verified" } },
      candidates: [{ id: "delay" }, { id: "pending_reversal" }, { id: "net_retained" }],
    });
  });
});
