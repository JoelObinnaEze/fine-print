import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createRunServer } from "../../apps/server/src/app.js";
import { BudgetService } from "../../apps/server/src/budget/service.js";
import { readServerConfig } from "../../apps/server/src/config.js";
import { openDatabase } from "../../apps/server/src/persistence/database.js";
import { RunService } from "../../apps/server/src/runs/service.js";

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
});

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    MODEL_API_KEY: "test-secret",
    META_BASE_URL: "https://api.meta.ai/v1",
    META_MODEL_ID: "muse-spark-1.3",
    EVENT_CREDITS_CONFIRMED: "true",
    EVENT_CREDITS_REMAINING_USD: "10",
    APP_BUDGET_USD: "1",
    SESSION_BUDGET_USD: "1",
    SEARCH_BUDGET_USD: "0.6",
    META_INPUT_USD_PER_MILLION: "1.25",
    META_OUTPUT_USD_PER_MILLION: "4.25",
    LIVE_AGENT_ENABLED: "true",
    MAX_CONCURRENT_PROVIDER_REQUESTS: "1",
    ...overrides,
  };
}

describe("safe server configuration", () => {
  it("fails closed without explicit credit confirmation or a positive budget", () => {
    const unconfirmed = readServerConfig(environment({ EVENT_CREDITS_CONFIRMED: undefined }));
    const noBudget = readServerConfig(environment({ APP_BUDGET_USD: "0" }));

    expect(unconfirmed.liveAgent.isEnabled).toBe(false);
    expect(unconfirmed.liveAgent.reasons).toContain("Credit availability is not confirmed.");
    expect(noBudget.liveAgent.isEnabled).toBe(false);
    expect(noBudget.liveAgent.reasons).toContain("A positive app budget is required.");
  });
});

describe("usage reservations", () => {
  it("refuses disabled live mode and rounds fractional microdollars upward", () => {
    const database = openDatabase(":memory:");
    const disabled = new BudgetService(
      database,
      readServerConfig(environment({ EVENT_CREDITS_CONFIRMED: undefined })),
      "disabled-session",
    );
    expect(() =>
      disabled.reserve({ runId: null, scopeId: "disabled", estimatedUsd: 0.1 }),
    ).toThrow("disabled");

    const enabled = new BudgetService(database, readServerConfig(environment()), "enabled-session");
    expect(
      enabled.reserve({ runId: null, scopeId: "fractional", estimatedUsd: 0.00000125 }),
    ).toMatchObject({ reservedUsd: 0.000002 });
    database.close();
  });

  it("serializes concurrent reservations and retains ambiguous worst-case cost", async () => {
    const database = openDatabase(":memory:");
    const config = readServerConfig(environment());
    const budget = new BudgetService(database, config, "test-session");

    const attempts = await Promise.allSettled([
      Promise.resolve().then(() =>
        budget.reserve({ runId: null, scopeId: "search-1", estimatedUsd: 0.6 }),
      ),
      Promise.resolve().then(() =>
        budget.reserve({ runId: null, scopeId: "search-1", estimatedUsd: 0.6 }),
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);

    const reservation = attempts.find((attempt) => attempt.status === "fulfilled")!.value;
    budget.settle(reservation.id, { state: "ambiguous" });
    expect(() =>
      budget.reserve({ runId: null, scopeId: "search-1", estimatedUsd: 0.01 }),
    ).toThrow("search budget");

    const settled = budget.reserve({ runId: null, scopeId: "search-2", estimatedUsd: 0.4 });
    budget.settle(settled.id, { state: "settled", actualUsd: 0.2 });
    expect(budget.getUsage()).toMatchObject({
      reservedUsd: 0,
      ambiguousUsd: 0.6,
      settledUsd: 0.2,
      availableAppUsd: 0.2,
      availableSessionUsd: 0.2,
    });
    database.close();
  });

  it("returns health and usage without exposing provider credentials", async () => {
    const database = openDatabase(":memory:");
    const config = readServerConfig(environment());
    const budget = new BudgetService(database, config, "health-session");
    const runService = new RunService(database);
    const server = createRunServer(runService, { config, budget });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    const health = await healthResponse.json();
    const usage = await (await fetch(`http://127.0.0.1:${port}/api/usage`)).json();
    const publicJson = JSON.stringify({ health, usage });

    expect(health).toMatchObject({ status: "ok", liveAgent: { isEnabled: true } });
    expect(healthResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(healthResponse.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(usage).toMatchObject({ appBudgetUsd: 1, sessionBudgetUsd: 1 });
    expect(publicJson).not.toContain("test-secret");
    expect(publicJson).not.toContain("MODEL_API_KEY");
    database.close();
  });
});
