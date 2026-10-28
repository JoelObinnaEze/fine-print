import { createRunServer } from "./app.js";
import { BudgetService } from "./budget/service.js";
import { readServerConfig } from "./config.js";
import { openDatabase } from "./persistence/database.js";
import { MetaPolicyTranslator } from "./providers/meta.js";
import { MetaCommerceInvestigator } from "./providers/meta-commerce.js";
import { LiveAttackService } from "./runs/live-attack-service.js";
import { RunService } from "./runs/service.js";

const host = "127.0.0.1";
const port = 8787;
const config = readServerConfig(process.env);
const database = openDatabase(config.databasePath);
const service = new RunService(database);
const budget = new BudgetService(database, config);
const translator = new MetaPolicyTranslator(database, config, budget);
const commerce = new MetaCommerceInvestigator(database, config, budget);
const attacks = new LiveAttackService(database, service, config, budget);
const server = createRunServer(service, { config, budget, translator, attacks, commerce });

server.listen(port, host, () => {
  console.log(`Fine Print server listening on http://${host}:${port}`);
});

function shutdown(): void {
  service.shutdown();
  server.close(() => database.close());
  server.closeAllConnections();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
