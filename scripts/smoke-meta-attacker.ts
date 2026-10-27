import { BudgetService } from "../apps/server/src/budget/service.js";
import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { initializeRunSchema } from "../apps/server/src/persistence/schema.js";
import { MetaAttackerProvider } from "../apps/server/src/providers/meta-attacker.js";
import {
  ATTACKER_LIMITS,
  BoundedAttackerSession,
  runBoundedAttacker,
} from "../apps/server/src/runs/agent.js";
import { RunService } from "../apps/server/src/runs/service.js";
import {
  canonicalHash,
  createBottleReturnState,
  ENGINE_VERSION,
} from "../packages/engine/src/index.js";
import {
  parsePolicyInterpretation,
  requireCandidatePolicy,
} from "../packages/policy/src/index.js";

const scopeId = "attacker-live-v2";
const config = readServerConfig(process.env);
if (!config.liveAgent.isEnabled) {
  throw new Error(`Live attacker is disabled: ${config.liveAgent.reasons.join(" ")}`);
}

const database = openDatabase(config.databasePath);
try {
  initializeRunSchema(database);
  const translation = database
    .prepare(
      "SELECT result_json FROM policy_translations WHERE state = 'succeeded' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { readonly result_json: string } | undefined;
  if (!translation) throw new Error("No successful policy translation is available.");

  const stored = JSON.parse(translation.result_json) as { readonly interpretation?: unknown };
  const policy = requireCandidatePolicy(parsePolicyInterpretation(stored.interpretation));
  if (database.prepare("SELECT 1 FROM agent_searches WHERE id = ?").get(scopeId)) {
    throw new Error("This live attacker search was already attempted and will not be sent again.");
  }
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO agent_searches
        (id, run_id, model_id, provenance, prompt_version, limits_json, status, result_json, created_at, updated_at)
      VALUES (?, NULL, ?, 'live_model', 'attacker-v1', ?, 'claimed', NULL, ?, ?)
    `)
    .run(scopeId, config.provider!.modelId, JSON.stringify(ATTACKER_LIMITS), now, now);

  const budget = new BudgetService(database, config, scopeId);
  const provider = new MetaAttackerProvider(config, budget, scopeId);
  const result = await runBoundedAttacker(
    new BoundedAttackerSession(createBottleReturnState(), policy),
    provider,
  );

  let runId: string | null = null;
  if (result.actions.length > 0) {
    const service = new RunService(database);
    const created = service.create(
      { policy, actions: [...result.actions] },
      `attacker-${canonicalHash(result.actions).slice(0, 32)}`,
    );
    let run = created.run;
    while (run.status === "queued" || run.status === "running") {
      await new Promise((resolve) => setImmediate(resolve));
      run = service.get(run.id);
    }
    service.shutdown();
    if (
      run.status !== "completed" ||
      canonicalHash({ engineVersion: ENGINE_VERSION, state: run.state }) !== result.stateHash
    ) {
      throw new Error("Persisted replay did not match the verified attacker state.");
    }
    runId = run.id;
  }

  database.transaction(() => {
    const insertTurn = database.prepare(`
      INSERT INTO agent_turns
        (search_id, sequence, strategy_summary, tool_calls_json, usage_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const turn of provider.turns) {
      insertTurn.run(
        scopeId,
        turn.sequence,
        turn.strategySummary,
        JSON.stringify(turn.toolCalls),
        JSON.stringify(turn.usage),
      );
    }
    database
      .prepare(`
        UPDATE agent_searches
        SET run_id = ?, status = ?, result_json = ?, updated_at = ?
        WHERE id = ? AND status = 'claimed'
      `)
      .run(
        runId,
        result.status === "run_incomplete" ? "incomplete" : "completed",
        JSON.stringify(result),
        new Date().toISOString(),
        scopeId,
      );
  })();

  console.log(JSON.stringify({ result, runId, usage: budget.getUsage() }, null, 2));
} finally {
  database.close();
}
