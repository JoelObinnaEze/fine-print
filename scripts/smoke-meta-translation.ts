import { BudgetService } from "../apps/server/src/budget/service.js";
import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { MetaPolicyTranslator } from "../apps/server/src/providers/meta.js";

const config = readServerConfig(process.env);
if (!config.liveAgent.isEnabled) {
  throw new Error(`Live translation is disabled: ${config.liveAgent.reasons.join(" ")}`);
}

const database = openDatabase(config.databasePath);
try {
  const budget = new BudgetService(database, config, "meta-translation-smoke-session");
  const translator = new MetaPolicyTranslator(database, config, budget);
  const result = await translator.translate(
    "Pay 10 points whenever any item is deposited.",
    "meta-translation-smoke-v3",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
