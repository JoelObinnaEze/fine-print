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
      expect(JSON.stringify(body)).toContain("Self-referral is invalid");
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

  it("executes a coherent trace when Muse names the two simulator accounts", async () => {
    const namedActions = [
      { type: "refer", referrerId: "Alice", customerId: "Bob" },
      {
        type: "purchase",
        accountId: "Bob",
        purchaseId: "order_35",
        priceUsd: 35,
        promoCreditUsd: 0,
      },
      { type: "refund", accountId: "Bob", purchaseId: "order_35" },
    ] as const;
    const namedPolicy = {
      ...vulnerableCommercePolicy,
      referral: {
        ...vulnerableCommercePolicy.referral,
        rewardUsd: 9,
        qualifyingPurchaseUsd: 35,
        returnWindowDays: 21,
      },
    };
    const { commerce } = createServices(async () =>
      completion({
        ...modelOutput,
        policy: namedPolicy,
        attackActions: namedActions,
        candidates: modelOutput.candidates.map((candidate) => ({
          ...candidate,
          policy: {
            ...candidate.policy,
            referral: {
              ...candidate.policy.referral,
              rewardUsd: 9,
              qualifyingPurchaseUsd: 35,
              returnWindowDays: 21,
            },
          },
        })),
      }),
    );

    const result = await commerce.investigate(
      {
        ...request,
        goal: { ...request.goal, minimumUsd: 35 },
      },
      "commerce-named-accounts",
    );

    expect(result.attack).toMatchObject({
      minimizedActions: [
        { type: "refer", referrerId: "A", customerId: "B" },
        { type: "purchase", accountId: "B", purchaseId: "order_35" },
        { type: "refund", accountId: "B", purchaseId: "order_35" },
      ],
      verification: {
        status: "exploit_verified",
        unintendedPayoutUsd: 18,
        retainedRevenueUsd: 0,
      },
    });
    expect(result.attack?.events.map((event) => event.summary)).toEqual([
      "A referred B.",
      "B bought order_35 for $35.",
      "B refunded order_35.",
    ]);
    expect(result.candidates.every((candidate) => candidate.evaluation.knownAttackBlocked)).toBe(
      true,
    );
  });

  it("accepts an attack-only recheck with no executable candidate", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      expect(body.messages[1]?.content).toContain('"mode":"attack_only"');
      return completion({
        ...modelOutput,
        reason: "The repaired policy was mapped, but no executable attack candidate was found.",
        policy: commerceRepairCandidates[0]!.policy,
        attackHypothesis: "",
        attackActions: [],
        candidates: [],
      });
    });
    const { commerce } = createServices(fetchMock);

    const result = await commerce.investigate(
      {
        ...request,
        mode: "attack_only",
        sourceText:
          "Give both people $10 immediately after a $20 purchase. Reverse the credit after a refund.",
      },
      "commerce-attack-only-no-candidate",
    );

    expect(result).toMatchObject({
      mapping: { status: "candidate", policy: commerceRepairCandidates[0]!.policy },
      attack: {
        hypothesis: "Muse returned no executable attack candidate in this attempt.",
        proposedActionCount: 0,
        minimizedActions: [],
        verification: { status: "no_exploit", unintendedPayoutUsd: 0 },
        events: [],
      },
      candidates: [],
    });
  });

  it("persists a fresh counterexample and refreshes the originating repair evidence", async () => {
    const reverseNowPolicy = {
      ...vulnerableCommercePolicy,
      name: "Reverse immediately",
      referral: { ...vulnerableCommercePolicy.referral, refundHandling: "reverse" as const },
    };
    const fullOutput = {
      ...modelOutput,
      candidates: [
        {
          id: "reverse-now",
          label: "Reverse credit on refund",
          tradeoff: "Fast rewards, with recovery bookkeeping.",
          complexity: 1,
          policy: reverseNowPolicy,
        },
        ...modelOutput.candidates.slice(0, 2),
      ],
    };
    const spentBeforeRefund = [
      { type: "refer", referrerId: "A", customerId: "B" },
      { type: "purchase", accountId: "B", purchaseId: "P1", priceUsd: 20, promoCreditUsd: 0 },
      { type: "purchase", accountId: "A", purchaseId: "P2", priceUsd: 10, promoCreditUsd: 10 },
      { type: "refund", accountId: "B", purchaseId: "P1" },
    ] as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion(fullOutput))
      .mockResolvedValueOnce(
        completion({
          ...modelOutput,
          policy: reverseNowPolicy,
          attackHypothesis: "Spend one issued credit before refunding the qualifying purchase.",
          attackActions: spentBeforeRefund,
          candidates: [],
        }),
      );
    const { commerce, database } = createServices(fetchMock);

    const first = await commerce.investigate(request, "commerce-evidence-root");
    const reverseCandidate = first.candidates.find((candidate) => candidate.id === "reverse-now")!;
    expect(reverseCandidate.evaluation.attack.verifiedUnintendedPayoutUsd).toBe(0);

    const fresh = await commerce.investigate(
      {
        ...request,
        mode: "attack_only",
        sourceText: "Give both people $10 immediately and reverse it after a refund.",
        evidenceContext: {
          evidenceSetId: first.id,
          testedCandidateId: reverseCandidate.id,
          expectedPolicyHash: reverseCandidate.policyHash,
        },
      },
      "commerce-evidence-fresh",
    );

    expect(fresh).toMatchObject({
      testedCandidateId: "reverse-now",
      policyHash: reverseCandidate.policyHash,
      attack: { verification: { status: "exploit_verified", unintendedPayoutUsd: 10 } },
      evidenceUpdate: {
        evidenceSetId: first.id,
        totalConfirmedCases: 2,
      },
    });
    const updatedReverse = fresh.evidenceUpdate?.candidates.find(
      (candidate) => candidate.id === "reverse-now",
    );
    expect(updatedReverse?.evaluation.attack.verifiedUnintendedPayoutUsd).toBe(10);
    expect(updatedReverse?.evaluation.evidence).toMatchObject({
      applicableCases: 2,
      highestObservedExposureUsd: 10,
    });
    expect(
      database
        .prepare("SELECT tested_candidate_id, observed_exposure_usd FROM commerce_counterexamples ORDER BY created_at")
        .all(),
    ).toEqual([
      { tested_candidate_id: null, observed_exposure_usd: 20 },
      { tested_candidate_id: "reverse-now", observed_exposure_usd: 10 },
    ]);
  });

  it("rejects fresh evidence mapped to a different repair version", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion(modelOutput))
      .mockResolvedValueOnce(
        completion({
          ...modelOutput,
          policy: vulnerableCommercePolicy,
          candidates: [],
        }),
      );
    const { commerce, database } = createServices(fetchMock);
    const first = await commerce.investigate(request, "commerce-version-root");
    const selected = first.candidates[0]!;

    await expect(
      commerce.investigate(
        {
          ...request,
          mode: "attack_only",
          evidenceContext: {
            evidenceSetId: first.id,
            testedCandidateId: selected.id,
            expectedPolicyHash: selected.policyHash,
          },
        },
        "commerce-version-mismatch",
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM commerce_counterexamples").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT state, error_code FROM commerce_investigations WHERE idempotency_key = ?")
        .get("commerce-version-mismatch"),
    ).toEqual({ state: "incomplete", error_code: "PROVIDER_OUTPUT_INVALID" });
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

  it("rejects candidate mappings with unsupported conditions or duplicate repairs", async () => {
    const duplicateRepairs = modelOutput.candidates.map((candidate, index) => ({
      ...candidate,
      id: `duplicate-${index}`,
      policy: modelOutput.candidates[0]!.policy,
    }));
    const invalidOutputs = [
      { ...modelOutput, unsupportedConditions: ["country eligibility"] },
      { ...modelOutput, candidates: duplicateRepairs },
    ];

    for (const [index, output] of invalidOutputs.entries()) {
      const { commerce } = createServices(async () => completion(output));
      await expect(
        commerce.investigate(request, `commerce-invalid-${index}`),
      ).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INVALID" });
    }
  });

  it("marks an investigation incomplete when reported usage exceeds its reservation", async () => {
    const { budget, commerce, database } = createServices(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-commerce-overage",
          choices: [{
            index: 0,
            message: { role: "assistant", content: JSON.stringify(modelOutput) },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: 1_000_000,
            completion_tokens: 1_000_000,
            total_tokens: 2_000_000,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      commerce.investigate(request, "commerce-overage"),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTCOME_UNKNOWN" });
    expect(budget.getUsage().ambiguousUsd).toBeGreaterThan(0);
    expect(
      database
        .prepare("SELECT state FROM commerce_investigations WHERE idempotency_key = ?")
        .get("commerce-overage"),
    ).toEqual({ state: "incomplete" });
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
