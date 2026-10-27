import type Database from "better-sqlite3";

export function initializeRunSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id TEXT PRIMARY KEY,
      policy_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policy_versions(id),
      status TEXT NOT NULL,
      initial_state_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actions (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      action_json TEXT NOT NULL,
      PRIMARY KEY (run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS events (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_sequence INTEGER NOT NULL,
      clause_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      predicate_results_json TEXT NOT NULL,
      PRIMARY KEY (run_id, event_sequence, clause_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS idempotency_claims (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
      created_at TEXT NOT NULL
    );
  `);
}

export function recoverUnfinishedRuns(database: Database.Database, timestamp: string): void {
  const unfinished = database
    .prepare(`
      SELECT runs.id, COALESCE(MAX(events.sequence), 0) AS last_sequence
      FROM runs
      LEFT JOIN events ON events.run_id = runs.id
      WHERE runs.status IN ('queued', 'running')
      GROUP BY runs.id
    `)
    .all() as { readonly id: string; readonly last_sequence: number }[];
  const update = database.prepare(
    "UPDATE runs SET status = 'interrupted', error = ?, updated_at = ? WHERE id = ?",
  );
  const insertEvent = database.prepare(
    "INSERT INTO events (run_id, sequence, type, data_json) VALUES (?, ?, 'run.interrupted', ?)",
  );
  database.transaction(() => {
    for (const run of unfinished) {
      const message = "Run interrupted by server restart.";
      update.run(message, timestamp, run.id);
      insertEvent.run(run.id, run.last_sequence + 1, JSON.stringify({ message }));
    }
  })();
}
