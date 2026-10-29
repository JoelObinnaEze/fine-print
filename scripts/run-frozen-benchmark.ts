import { canonicalHash } from "../packages/engine/src/index.js";
import { BudgetService } from "../apps/server/src/budget/service.js";
import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { initializeRunSchema } from "../apps/server/src/persistence/schema.js";
import { MetaCommerceInvestigator } from "../apps/server/src/providers/meta-commerce.js";
import { LiveAttackService } from "../apps/server/src/runs/live-attack-service.js";
import { RunService } from "../apps/server/src/runs/service.js";
import { frozenEvaluationSuite } from "./frozen-evaluation-suite.js";

const config = readServerConfig(process.env);
if (!config.liveAgent.isEnabled || !config.provider) {
  throw new Error(`Live frozen benchmark is disabled: ${config.liveAgent.reasons.join("; ")}`);
}

const database = openDatabase(config.databasePath);
try {
  initializeRunSchema(database);
  const runs = new RunService(database);
  const budget = new BudgetService(database, config, "frozen-benchmark-v2");
  const attacks = new LiveAttackService(database, runs, config, budget);
  const commerce = new MetaCommerceInvestigator(database, config, budget);

  for (const item of frozenEvaluationSuite.cases) {
    if (item.domain === "bottle_return") {
      const existing = database
        .prepare("SELECT COUNT(*) AS count FROM agent_searches WHERE policy_hash = ? AND result_json IS NOT NULL")
        .get(canonicalHash(item.policy)) as { readonly count: number };
      for (let repeat = existing.count + 1; repeat <= 3; repeat += 1) {
        const searchId = `frozen-v3-${item.id}-${repeat}`;
        try {
          const result = await attacks.run(item.policy, searchId);
          console.log(JSON.stringify({
            caseId: item.id,
            repeat,
            outcome: result.report.outcome,
            requests: result.report.requestsUsed,
            actions: result.report.actionsTested,
            actualUsd: result.usage.actualUsd,
            replayed: result.replayed,
          }));
        } catch (error) {
          console.log(JSON.stringify({
            caseId: item.id,
            repeat,
            outcome: "interrupted",
            reason: error instanceof Error ? error.message : "Unknown benchmark error",
          }));
        }
      }
      continue;
    }

    if (item.mechanism === "promotional_credit_qualification") {
      console.log(JSON.stringify({
        caseId: item.id,
        outcome: "not_run",
        reason: "The live commerce investigator currently fixes the initial account credit at $0; the offline reference case uses a disclosed $20 starting credit.",
      }));
      continue;
    }
    for (let repeat = 1; repeat <= 3; repeat += 1) {
      const idempotencyKey = `frozen-v3-${item.id}-${repeat}`;
      try {
        const result = await commerce.investigate(
          {
            sourceText: item.sourceText,
            goal: item.goal,
            restrictions: [item.protectedLegitimateBehavior],
            mode: "attack_only",
          },
          idempotencyKey,
        );
        console.log(JSON.stringify({
          caseId: item.id,
          repeat,
          mappingMatchesFrozenPolicy:
            result.mapping.policy !== null &&
            canonicalHash(result.mapping.policy.referral) === canonicalHash(item.policy.referral),
          outcome: result.attemptOutcome,
          actions: result.attack?.proposedActionCount ?? 0,
          actualUsd: result.usage.actualUsd,
          replayed: result.replayed,
        }));
      } catch (error) {
        console.log(JSON.stringify({
          caseId: item.id,
          repeat,
          outcome: "interrupted",
          reason: error instanceof Error ? error.message : "Unknown benchmark error",
        }));
      }
    }
  }
} finally {
  database.close();
}
