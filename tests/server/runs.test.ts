import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createRunServer } from "../../apps/server/src/app.js";
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

async function startServer(service = new RunService()) {
  const server = createRunServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, service };
}

async function postRun(baseUrl: string, key: string, body: unknown) {
  return fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

async function waitForTerminal(baseUrl: string, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}`);
    const run = (await response.json()) as { readonly status: string };
    if (["completed", "cancelled", "infrastructure_error"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("run did not reach a terminal status");
}

describe("local run API", () => {
  it("validates boundaries and honours idempotency keys", async () => {
    const { baseUrl } = await startServer();
    const body = { policy, actions: [{ type: "wait" }] };

    const missingKey = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(missingKey.status).toBe(400);
    await expect(missingKey.json()).resolves.toMatchObject({
      error: { code: "INVALID_IDEMPOTENCY_KEY" },
    });

    const created = await postRun(baseUrl, "run-intent-1", body);
    expect(created.status).toBe(201);
    const first = (await created.json()) as { readonly id: string };

    const replayed = await postRun(baseUrl, "run-intent-1", body);
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({ id: first.id });

    const conflict = await postRun(baseUrl, "run-intent-1", {
      policy,
      actions: [{ type: "finish" }],
    });
    expect(conflict.status).toBe(422);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });

    const invalidId = await fetch(`${baseUrl}/api/runs/not-a-run`);
    expect(invalidId.status).toBe(400);
    await expect(invalidId.json()).resolves.toMatchObject({
      error: { code: "INVALID_RUN_ID" },
    });

    const oversized = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "oversized" },
      body: JSON.stringify({ padding: "x".repeat(65_536) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("cancels a non-terminal run without executing late actions", async () => {
    const { baseUrl } = await startServer();
    const created = await postRun(baseUrl, "cancel-intent", {
      policy,
      actions: Array.from({ length: 120 }, () => ({ type: "wait" })),
    });
    const run = (await created.json()) as { readonly id: string };

    const cancelled = await fetch(`${baseUrl}/api/runs/${run.id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({ status: "cancelled" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await fetch(`${baseUrl}/api/runs/${run.id}`);
    const finalRun = (await status.json()) as { readonly status: string; readonly state: { readonly tick: number } };
    expect(finalRun.status).toBe("cancelled");
    expect(finalRun.state.tick).toBeLessThan(120);
  });

  it("streams ordered events after the Last-Event-ID on reconnect", async () => {
    const { baseUrl } = await startServer();
    const created = await postRun(baseUrl, "stream-intent", {
      policy,
      actions: [{ type: "wait" }, { type: "finish" }],
    });
    const run = (await created.json()) as { readonly id: string };
    await waitForTerminal(baseUrl, run.id);

    const stream = await fetch(`${baseUrl}/api/runs/${run.id}/events`, {
      headers: { "last-event-id": "2" },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const text = await stream.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id > 2)).toBe(true);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(text).toContain("event: run.completed");
  });
});
