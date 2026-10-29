import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { createRunServer } from "../../apps/server/src/app.js";
import { BudgetService } from "../../apps/server/src/budget/service.js";
import { readServerConfig } from "../../apps/server/src/config.js";
import { openDatabase } from "../../apps/server/src/persistence/database.js";
import { MetaPolicyTranslator } from "../../apps/server/src/providers/meta.js";
import { RunService } from "../../apps/server/src/runs/service.js";
import {
  parsePolicyInterpretation,
  requireCandidatePolicy,
} from "../../packages/policy/src/interpret.js";
import { parsePolicy, type Policy } from "../../packages/policy/src/index.js";

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

const databases = [] as ReturnType<typeof openDatabase>[];
const servers: Server[] = [];

afterAll(() => {
  for (const database of databases) {
    if (database.open) database.close();
  }
});

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

function createServices(fetchImplementation: typeof fetch) {
  const database = openDatabase(":memory:");
  databases.push(database);
  const config = readServerConfig(environment());
  const budget = new BudgetService(database, config, "translation-session");
  return {
    budget,
    config,
    database,
    translator: new MetaPolicyTranslator(database, config, budget, fetchImplementation),
  };
}

describe("policy interpretation", () => {
  it("uses the strict policy validator and refuses non-candidates", () => {
    const candidate = parsePolicyInterpretation({ status: "candidate", reason: "Literal rule.", policy });
    expect(requireCandidatePolicy(candidate)).toEqual(parsePolicy(policy));

    const ambiguous = parsePolicyInterpretation({
      status: "ambiguous",
      reason: "The trigger is not specified.",
      policy: { schemaVersion: 1, clauses: [] },
    });
    expect(() => requireCandidatePolicy(ambiguous)).toThrow("not activatable");
    expect(() =>
      parsePolicyInterpretation({
        status: "candidate",
        reason: "Invalid extra behavior.",
        policy: { ...policy, executable: "doSomething()" },
      }),
    ).toThrow();
  });
});

describe("Meta policy translator", () => {
  it("decodes UTF-8 correctly when a character spans request chunks", async () => {
    let providerBody = "";
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      providerBody = String(init?.body);
      return new Response(
        JSON.stringify({
          id: "chatcmpl-utf8",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                status: "unsupported",
                reason: "Outside the supported semantics.",
                policy: { schemaVersion: 1, clauses: [] },
              }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { budget, config, database, translator } = createServices(fetchMock);
    const server = createRunServer(new RunService(database), { config, budget, translator });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const body = Buffer.from(JSON.stringify({ text: "Pay for café." }));
    const split = body.indexOf(0xc3) + 1;

    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/policies/translate",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": body.length,
            "idempotency-key": "translate-utf8",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        },
      );
      request.on("error", reject);
      request.flushHeaders();
      request.write(body.subarray(0, split));
      setImmediate(() => request.end(body.subarray(split)));
    });

    expect(status).toBe(200);
    expect(providerBody).toContain("café");
    expect(providerBody).not.toContain("�");
  });

  it("sends the documented bounded request, validates the fixture, and replays one idempotent result", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://api.meta.ai/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "muse-spark-1.3",
        max_completion_tokens: 1_200,
        reasoning_effort: "low",
        response_format: { type: "json_schema", json_schema: { strict: false } },
      });
      expect(JSON.stringify(body)).toContain("developer");

      return new Response(
        JSON.stringify({
          id: "chatcmpl-fixture",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ status: "candidate", reason: "Literal rule.", policy }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { budget, config, database, translator } = createServices(fetchMock);
    const server = createRunServer(new RunService(database), { config, budget, translator });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const request = () =>
      fetch(`http://127.0.0.1:${port}/api/policies/translate`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "translate-1" },
        body: JSON.stringify({ text: "Pay 10 points whenever an item is deposited." }),
      });

    const firstResponse = await request();
    const first = (await firstResponse.json()) as {
      readonly id: string;
      readonly replayed: boolean;
      readonly interpretation: { readonly status: string; readonly policy: Policy };
    };
    const replayedResponse = await request();
    const replayed = (await replayedResponse.json()) as typeof first;

    expect(firstResponse.status).toBe(200);
    expect(replayedResponse.status).toBe(200);
    expect(first).toMatchObject({ replayed: false, interpretation: { status: "candidate", policy } });
    expect(replayed).toMatchObject({ replayed: true, id: first.id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.getUsage()).toMatchObject({ reservedUsd: 0, ambiguousUsd: 0 });
    expect(JSON.stringify(first)).not.toContain("test-secret");
  });

  it("retains the reservation and refuses a duplicate after an ambiguous timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const { budget, translator } = createServices(fetchMock);

    await expect(translator.translate("Pay for bottles.", "translate-timeout")).rejects.toThrow(
      "outcome is unknown",
    );
    await expect(translator.translate("Pay for bottles.", "translate-timeout")).rejects.toThrow(
      "already attempted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.getUsage().ambiguousUsd).toBeGreaterThan(0);
  });

  it("retains the reservation when provider token totals are inconsistent", async () => {
    const { budget, translator } = createServices(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-bad-usage",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                status: "unsupported",
                reason: "Outside the supported semantics.",
                policy: { schemaVersion: 1, clauses: [] },
              }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      translator.translate("Pay for bottles.", "translate-bad-usage"),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTCOME_UNKNOWN" });
    expect(budget.getUsage().ambiguousUsd).toBeGreaterThan(0);
  });

  it("settles known usage but refuses truncated output", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-truncated",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "{}" },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 120, total_tokens: 200 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { budget, translator } = createServices(fetchMock);

    await expect(translator.translate("Pay for bottles.", "translate-truncated")).rejects.toThrow(
      "truncated",
    );
    expect(budget.getUsage()).toMatchObject({ reservedUsd: 0, ambiguousUsd: 0 });
    expect(budget.getUsage().settledUsd).toBeGreaterThan(0);
  });

  it("allows only one provider request in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-concurrency",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  status: "unsupported",
                  reason: "Outside the supported semantics.",
                  policy: { schemaVersion: 1, clauses: [] },
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { translator } = createServices(fetchMock);

    const first = translator.translate("Pay for every item deposited.", "concurrency-1");
    await expect(
      translator.translate("Pay for every item processed.", "concurrency-2"),
    ).rejects.toThrow("already in progress");
    release();
    await expect(first).resolves.toMatchObject({ interpretation: { status: "unsupported" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serializes provider requests across service instances", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requests += 1;
      if (requests === 1) await gate;
      return new Response(
        JSON.stringify({
          id: `chatcmpl-global-${requests}`,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                status: "unsupported",
                reason: "Outside the supported semantics.",
                policy: { schemaVersion: 1, clauses: [] },
              }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const { budget, config, database, translator } = createServices(fetchMock);
    const secondTranslator = new MetaPolicyTranslator(database, config, budget, fetchMock);
    const first = translator.translate("Pay for bottles.", "global-concurrency-1");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await expect(
      secondTranslator.translate("Pay for cans.", "global-concurrency-2"),
    ).rejects.toMatchObject({ code: "PROVIDER_BUSY" });
    release();
    await expect(first).resolves.toMatchObject({ interpretation: { status: "unsupported" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
