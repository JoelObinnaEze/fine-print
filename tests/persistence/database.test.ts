import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../apps/server/src/persistence/database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(join(directory, "fine-print.db"), { force: true });
    rmSync(join(directory, "fine-print.db-journal"), { force: true });
    rmdirSync(directory);
  }
});

describe("openDatabase", () => {
  it("persists committed rows and rolls back failed transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "fine-print-sqlite-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fine-print.db");

    const database = openDatabase(path);
    database.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
    database.prepare("INSERT INTO evidence (label) VALUES (?)").run("verified");
    const failingTransaction = database.transaction(() => {
      database.prepare("INSERT INTO evidence (label) VALUES (?)").run("discarded");
      throw new Error("rollback");
    });
    expect(failingTransaction).toThrow("rollback");
    database.close();

    const reopened = openDatabase(path);
    expect(reopened.prepare("SELECT label FROM evidence ORDER BY id").all()).toEqual([
      { label: "verified" },
    ]);
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
    reopened.close();
  });
});
