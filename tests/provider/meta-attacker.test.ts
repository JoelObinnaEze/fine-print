import { afterAll, describe, expect, it, vi } from "vitest";

import { BudgetService } from "../../apps/server/src/budget/service.js";
import { readServerConfig } from "../../apps/server/src/config.js";
import { openDatabase } from "../../apps/server/src/persistence/database.js";
import { MetaAttackerProvider } from "../../apps/server/src/providers/meta-attacker.js";
import {
  BoundedAttackerSession,
  runBoundedAttacker,
} from "../../apps/server/src/runs/agent.js";
import { createBottleReturnState } from "../../packages/engine/src/index.js";
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

const databases = [] as ReturnType<typeof openDatabase>[];

afterAll(() => {
  for (const database of databases) database.close();
});

function services(fetchImplementation: typeof fetch) {
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
  const budget = new BudgetService(database, config, "attacker-session");
  return {
    budget,
    provider: new MetaAttackerProvider(config, budget, "attacker-search", fetchImplementation),
  };
}

function completion(input: {
  readonly content: string | null;
  readonly toolCalls?: readonly unknown[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}) {
  const promptTokens = input.promptTokens ?? 100;
  const completionTokens = input.completionTokens ?? 50;
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: input.content,
            ...(input.toolCalls ? { tool_calls: input.toolCalls } : {}),
          },
          finish_reason: input.toolCalls ? "tool_calls" : "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Meta attacker provider", () => {
  it("uses the documented Chat Completions tool loop and settles verified usage", async () => {
    const bodies: unknown[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return completion({
          content: "Inspect the public state first.",
          toolCalls: [
            {
              id: "call-inspect",
              type: "function",
              function: { name: "inspect", arguments: "{}" },
            },
          ],
        });
      }
      return completion({
        content: "Submit the observed repeated-deposit trace.",
        toolCalls: [
          {
            id: "call-submit",
            type: "function",
            function: {
              name: "submit_candidate",
              arguments: JSON.stringify({
                actions: exploitActions,
                summary: "Repeated deposits paid without recycling.",
                evidenceEventIds: [7, 9, 11],
              }),
            },
          },
        ],
        promptTokens: 200,
        completionTokens: 100,
      });
    });
    const { budget, provider } = services(fetchImplementation);

    const result = await runBoundedAttacker(
      new BoundedAttackerSession(createBottleReturnState(), policy),
      provider,
    );

    expect(result).toMatchObject({
      status: "exploit_verified",
      totalReward: 30,
      usefulItems: 0,
      requestsUsed: 2,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(bodies[0]).toMatchObject({
      model: "muse-spark-1.3",
      parallel_tool_calls: false,
      reasoning_effort: "low",
      messages: [{ role: "developer" }, { role: "user" }],
    });
    expect((bodies[0] as { tools: unknown[] }).tools).toHaveLength(5);
    expect(
      (bodies[0] as { messages: Array<{ content: string }> }).messages[0]!.content,
    ).toContain("submit the current trial immediately on the next turn");
    expect(bodies[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({ role: "tool", tool_call_id: "call-inspect" }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("Search turn 2 of 12") }),
      ]),
    });
    expect(JSON.stringify({ result, bodies })).not.toContain("test-secret");
    expect(budget.getUsage()).toMatchObject({
      reservedUsd: 0,
      ambiguousUsd: 0,
      settledUsd: 0.001013,
    });
  });

  it("retains the reservation when the request outcome is unknown", async () => {
    const { budget, provider } = services(async () => {
      throw new Error("socket closed");
    });

    const result = await runBoundedAttacker(
      new BoundedAttackerSession(createBottleReturnState(), policy),
      provider,
    );

    expect(result).toMatchObject({ status: "run_incomplete", requestsUsed: 1 });
    expect(budget.getUsage()).toMatchObject({
      settledUsd: 0,
      ambiguousUsd: expect.any(Number),
      reservedUsd: 0,
    });
    expect(budget.getUsage().ambiguousUsd).toBeGreaterThan(0);
  });
});
