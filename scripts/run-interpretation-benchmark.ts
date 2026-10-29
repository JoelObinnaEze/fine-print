import { BudgetService } from "../apps/server/src/budget/service.js";
import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { initializeRunSchema } from "../apps/server/src/persistence/schema.js";
import { MetaCommerceInvestigator } from "../apps/server/src/providers/meta-commerce.js";
import { MetaPolicyTranslator } from "../apps/server/src/providers/meta.js";
import { commerceGoal } from "../packages/commerce/src/index.js";
import { interpretationSuite } from "./frozen-evaluation-suite.js";

const config = readServerConfig(process.env);
if (!config.liveAgent.isEnabled || !config.provider) {
  throw new Error(`Live interpretation benchmark is disabled: ${config.liveAgent.reasons.join("; ")}`);
}

const database = openDatabase(config.databasePath);
try {
  initializeRunSchema(database);
  const budget = new BudgetService(database, config, "interpretation-benchmark-v1");
  const commerce = new MetaCommerceInvestigator(database, config, budget);
  const bottle = new MetaPolicyTranslator(database, config, budget);

  for (const item of interpretationSuite) {
    try {
      if (item.id.startsWith("commerce-")) {
        const result = await commerce.investigate(
          {
            sourceText: item.sourceText,
            goal: commerceGoal,
            restrictions: [],
            mode: "interpret_only",
          },
          `interpretation-v1-${item.id}`,
        );
        console.log(JSON.stringify({
          caseId: item.id,
          disposition: result.mapping.status,
          actualUsd: result.usage.actualUsd,
          replayed: result.replayed,
        }));
      } else {
        const result = await bottle.translate(
          item.sourceText,
          `interpretation-v1-${item.id}`,
        );
        console.log(JSON.stringify({
          caseId: item.id,
          disposition: result.interpretation.status,
          actualUsd: result.usage.actualUsd,
          replayed: result.replayed,
        }));
      }
    } catch (error) {
      console.log(JSON.stringify({
        caseId: item.id,
        disposition: "interrupted",
        reason: error instanceof Error ? error.message : "Unknown interpretation error",
      }));
    }
  }
} finally {
  database.close();
}
