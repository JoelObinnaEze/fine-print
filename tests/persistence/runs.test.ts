import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../apps/server/src/persistence/database.js";
import type { CreateRunInput } from "../../apps/server/src/runs/contracts.js";
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

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(join(directory, "fine-print.db"), { force: true });
    rmSync(join(directory, "fine-print.db-journal"), { force: true });
    rmdirSync(directory);
  }
});

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fine-print-runs-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "fine-print.db"));
  databases.push(database);
  return database;
}

async function waitForTerminal(service: RunService, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = service.get(runId);
    if (["completed", "cancelled", "interrupted", "infrastructure_error"].includes(run.status)) return run;
    await yieldToEventLoop();
  }
  throw new Error("run did not reach a terminal status");
}

describe("persistent runs", () => {
  it("commits complete replay evidence and unique idempotency claims", async () => {
    const database = createDatabase();
    const service = new RunService(database);
    const input: CreateRunInput = {
      policy,
      actions: [
        { type: "move", direction: "up" },
        { type: "take", itemId: "B1" },
        { type: "move", direction: "right" },
        { type: "move", direction: "right" },
        { type: "move", direction: "right" },
        { type: "move", direction: "right" },
        { type: "deposit" },
      ],
    };

    const created = service.create(input, "persist-intent");
    const completed = await waitForTerminal(service, created.run.id);
    const replayed = service.create(input, "persist-intent");

    expect(completed).toMatchObject({ status: "completed", eventCount: 11, state: { tick: 7 } });
    expect(replayed.replayed).toBe(true);
    expect(replayed.run.id).toBe(created.run.id);
    expect(database.prepare("SELECT count(*) AS count FROM policy_versions").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM runs").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM actions").get()).toEqual({ count: 7 });
    expect(database.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 11 });
    expect(database.prepare("SELECT count(*) AS count FROM payouts").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM idempotency_claims").get()).toEqual({ count: 1 });
    expect(() =>
      database
        .prepare("INSERT INTO events (run_id, sequence, type, data_json) VALUES (?, 1, 'duplicate', '{}')")
        .run(created.run.id),
    ).toThrow();
    expect(() =>
      database
        .prepare("INSERT INTO actions (run_id, sequence, action_json) VALUES ('missing-run', 1, '{}')")
        .run(),
    ).toThrow();
  });

  it("marks unfinished work interrupted on restart and never starts it again", async () => {
    const database = createDatabase();
    const firstService = new RunService(database);
    const input = {
      policy,
      actions: Array.from({ length: 120 }, () => ({ type: "wait" as const })),
    };
    const created = firstService.create(input, "restart-intent");
    firstService.shutdown();
    await yieldToEventLoop();
    database.close();

    const reopened = openDatabase(database.name);
    databases.push(reopened);
    const recoveredService = new RunService(reopened);
    const recovered = recoveredService.get(created.run.id);

    expect(recovered.status).toBe("interrupted");
    expect(recovered.error).toBe("Run interrupted by server restart.");
    expect(recoveredService.eventsAfter(recovered.id, 0).at(-1)?.type).toBe("run.interrupted");
    const retried = recoveredService.create(input, "restart-intent");
    expect(retried.replayed).toBe(true);
    expect(retried.run).toMatchObject({ id: recovered.id, status: "interrupted" });
    expect(reopened.prepare("SELECT count(*) AS count FROM runs").get()).toEqual({ count: 1 });
  });

  it("persists a verified discovery and replays it against a patched policy after restart", async () => {
    const database = createDatabase();
    const service = new RunService(database);
    const created = service.create(
      {
        policy,
        actions: [
          { type: "move", direction: "up" },
          { type: "take", itemId: "B1" },
          { type: "move", direction: "right" },
          { type: "move", direction: "right" },
          { type: "move", direction: "right" },
          { type: "move", direction: "right" },
          { type: "deposit" },
        ],
      },
      "regression-source",
    );
    await waitForTerminal(service, created.run.id);

    const saved = service.saveRegression(created.run.id, "Deposit before processing");
    const duplicate = service.saveRegression(created.run.id, "Ignored duplicate label");

    expect(saved).toMatchObject({
      replayed: false,
      regressionCase: {
        sourceRunId: created.run.id,
        label: "Deposit before processing",
        expectedExcessReward: 10,
      },
    });
    expect(duplicate).toEqual({ ...saved, replayed: true });
    expect(database.prepare("SELECT count(*) AS count FROM regression_cases").get()).toEqual({ count: 1 });
    database.close();

    const reopened = openDatabase(database.name);
    databases.push(reopened);
    const recoveredService = new RunService(reopened);
    const patched: Policy = {
      schemaVersion: 1,
      clauses: [
        {
          ...policy.clauses[0]!,
          id: "processed-item",
          trigger: "process",
          eligibleOnly: true,
          materials: ["plastic", "aluminium"],
          repetition: "once_per_item",
        },
      ],
    };

    expect(recoveredService.evaluateRegressions(patched)).toEqual([
      expect.objectContaining({
        id: saved.regressionCase.id,
        label: "Deposit before processing",
        sourceRunId: created.run.id,
        expectedExcessReward: 10,
        blocked: true,
        current: expect.objectContaining({
          status: "no_exploit_in_submitted_trace",
          excessReward: 0,
          totalReward: 0,
        }),
      }),
    ]);
  });
});
