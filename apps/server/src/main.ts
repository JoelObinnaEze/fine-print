import { createRunServer } from "./app.js";
import { openDatabase } from "./persistence/database.js";
import { RunService } from "./runs/service.js";

const host = "127.0.0.1";
const port = 8787;
const database = openDatabase(process.env.DATABASE_PATH ?? "fine-print.db");
const service = new RunService(database);
const server = createRunServer(service);

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
