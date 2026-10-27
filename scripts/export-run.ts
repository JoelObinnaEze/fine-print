import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readServerConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/persistence/database.js";
import { verifyRunExport } from "../apps/server/src/runs/export.js";
import { runIdSchema } from "../apps/server/src/runs/contracts.js";
import { RunService } from "../apps/server/src/runs/service.js";

const runId = runIdSchema.parse(process.argv[2]);
const outputPath = resolve(process.argv[3] ?? `${runId}.json`);
const config = readServerConfig(process.env);
const database = openDatabase(config.databasePath);
try {
  const exported = new RunService(database).export(runId);
  verifyRunExport(exported);
  writeFileSync(outputPath, `${JSON.stringify(exported, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(outputPath);
} finally {
  database.close();
}
