import { BudgetService } from "../apps/server/src/budget/service.js";
import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { LiveAttackService } from "../apps/server/src/runs/live-attack-service.js";
import { RunService } from "../apps/server/src/runs/service.js";
import { discoverySuite } from "./discovery-suite.js";

const config = readServerConfig(process.env);
if (!config.liveAgent.isEnabled || !config.provider) {
  throw new Error(`Live discovery benchmark is disabled: ${config.liveAgent.reasons.join("; ")}`);
}

const database = openDatabase(config.databasePath);
try {
  const runs = new RunService(database);
  const budget = new BudgetService(database, config, "discovery-benchmark-v1");
  const attacks = new LiveAttackService(database, runs, config, budget);
  for (const benchmark of discoverySuite) {
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      const searchId = `benchmark-v1-${benchmark.id}-${repeat}`;
      const result = await attacks.run(benchmark.policy, searchId);
      console.log(JSON.stringify({
        searchId,
        outcome: result.report.outcome,
        requests: result.report.requestsUsed,
        actions: result.report.actionsTested,
        actualUsd: result.usage.actualUsd,
        replayed: result.replayed,
      }));
    }
  }
} finally {
  database.close();
}
