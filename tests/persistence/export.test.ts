import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../apps/server/src/persistence/database.js";
import { verifyRunExport } from "../../apps/server/src/runs/export.js";
import { RunService } from "../../apps/server/src/runs/service.js";
import type { Action } from "../../packages/engine/src/index.js";
import type { Policy } from "../../packages/policy/src/index.js";

const everyDeposit: Policy = {
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

const oncePerItem: Policy = {
  ...everyDeposit,
  clauses: [{ ...everyDeposit.clauses[0]!, repetition: "once_per_item" }],
};

const prefix: readonly Action[] = [
  { type: "move", direction: "up" },
  { type: "take", itemId: "B1" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "move", direction: "right" },
  { type: "deposit" },
];
const continuation: readonly Action[] = [
  { type: "retrieve", itemId: "B1" },
  { type: "deposit" },
  { type: "finish" },
];

const databases = [] as ReturnType<typeof openDatabase>[];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function terminal(service: RunService, runId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = service.get(runId);
    if (!["queued", "running"].includes(run.status)) return run;
    await yieldToEventLoop();
  }
  throw new Error("run did not finish");
}

describe("run branches and export", () => {
  it("preserves both ledgers on a same-policy branch and reconstructs them for a changed policy", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const service = new RunService(database);
    const source = service.create(
      { policy: everyDeposit, actions: [...prefix, ...continuation] },
      "source-run",
    );
    await terminal(service, source.run.id);

    const samePolicy = service.branch(
      source.run.id,
      { branchTick: 7, policy: everyDeposit, actions: [...continuation] },
      "same-policy-branch",
    );
    const changedPolicy = service.branch(
      source.run.id,
      { branchTick: 7, policy: oncePerItem, actions: [...continuation] },
      "changed-policy-branch",
    );

    const same = await terminal(service, samePolicy.run.id);
    const changed = await terminal(service, changedPolicy.run.id);
    expect(same).toMatchObject({
      status: "completed",
      parentRunId: source.run.id,
      branchTick: 7,
      state: { rewardLedger: { totalPoints: 20 } },
    });
    expect(changed).toMatchObject({
      status: "completed",
      parentRunId: source.run.id,
      branchTick: 7,
      state: { rewardLedger: { totalPoints: 10 } },
    });
    expect(same.state.outcomeLedger).toEqual(changed.state.outcomeLedger);
  });

  it("exports a provenance-labelled replay and rejects corruption or version mismatch", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const service = new RunService(database);
    const created = service.create(
      { policy: everyDeposit, actions: [...prefix, ...continuation] },
      "export-run",
      {
        provenance: "recorded_model_replay",
        limits: { maxInferenceRequests: 12, maxTicksPerTrial: 120, maxTrials: 4 },
      },
    );
    await terminal(service, created.run.id);

    const exported = service.export(created.run.id);
    const verified = verifyRunExport(exported);
    expect(exported).toMatchObject({
      schemaVersion: 1,
      engineVersion: "1",
      runId: created.run.id,
      provenance: "recorded_model_replay",
      limits: { maxInferenceRequests: 12, maxTicksPerTrial: 120, maxTrials: 4 },
      usage: null,
    });
    expect(verified.state.rewardLedger.totalPoints).toBe(20);

    expect(() =>
      verifyRunExport({
        ...exported,
        actions: [{ type: "finish" }],
      }),
    ).toThrow("integrity");
    expect(() =>
      verifyRunExport({
        ...exported,
        engineVersion: "999",
      }),
    ).toThrow("version");
  });
});
