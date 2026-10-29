import type { AppDatabase } from "./database.js";

export function initializeRunSchema(database: AppDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id TEXT PRIMARY KEY,
      policy_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL REFERENCES policy_versions(id),
      parent_run_id TEXT REFERENCES runs(id),
      branch_tick INTEGER,
      provenance TEXT NOT NULL DEFAULT 'manual',
      model_id TEXT,
      limits_json TEXT NOT NULL DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS usage_reservations (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id),
      session_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      reserved_micros INTEGER NOT NULL CHECK (reserved_micros > 0),
      actual_micros INTEGER CHECK (actual_micros >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'ambiguous', 'released')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_translations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('claimed', 'succeeded', 'failed', 'ambiguous')),
      reservation_id TEXT REFERENCES usage_reservations(id),
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_searches (
      id TEXT PRIMARY KEY,
      run_id TEXT UNIQUE REFERENCES runs(id),
      model_id TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK (provenance IN ('live_model', 'recorded_model_replay')),
      prompt_version TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      policy_hash TEXT,
      policy_json TEXT,
      status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'incomplete')),
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_turns (
      search_id TEXT NOT NULL REFERENCES agent_searches(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      strategy_summary TEXT NOT NULL,
      tool_calls_json TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      PRIMARY KEY (search_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS regression_cases (
      id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      initial_state_json TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      expected_excess_reward INTEGER NOT NULL CHECK (expected_excess_reward > 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commerce_investigations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('claimed', 'completed', 'incomplete')),
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commerce_counterexamples (
      id TEXT PRIMARY KEY,
      evidence_set_id TEXT NOT NULL REFERENCES commerce_investigations(id) ON DELETE CASCADE,
      source_investigation_id TEXT NOT NULL UNIQUE REFERENCES commerce_investigations(id) ON DELETE CASCADE,
      source_policy_hash TEXT NOT NULL,
      tested_policy_hash TEXT NOT NULL,
      tested_candidate_id TEXT,
      initial_state_json TEXT,
      actions_json TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      observed_exposure_usd INTEGER NOT NULL CHECK (observed_exposure_usd > 0),
      created_at TEXT NOT NULL
    );
  `);

  const runColumns = new Set(
    (database.pragma("table_info(runs)") as { readonly name: string }[]).map((column) => column.name),
  );
  const migrations = [
    ["parent_run_id", "ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id)"],
    ["branch_tick", "ALTER TABLE runs ADD COLUMN branch_tick INTEGER"],
    ["provenance", "ALTER TABLE runs ADD COLUMN provenance TEXT NOT NULL DEFAULT 'manual'"],
    ["model_id", "ALTER TABLE runs ADD COLUMN model_id TEXT"],
    ["limits_json", "ALTER TABLE runs ADD COLUMN limits_json TEXT NOT NULL DEFAULT '{}'"],
  ] as const;
  for (const [column, sql] of migrations) {
    if (!runColumns.has(column)) database.exec(sql);
  }
  const searchColumns = new Set(
    (database.pragma("table_info(agent_searches)") as { readonly name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!searchColumns.has("policy_hash")) {
    database.exec("ALTER TABLE agent_searches ADD COLUMN policy_hash TEXT");
  }
  if (!searchColumns.has("policy_json")) {
    database.exec("ALTER TABLE agent_searches ADD COLUMN policy_json TEXT");
  }
  const commerceColumns = new Set(
    (database.pragma("table_info(commerce_investigations)") as { readonly name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!commerceColumns.has("error_code")) {
    database.exec("ALTER TABLE commerce_investigations ADD COLUMN error_code TEXT");
  }
  if (!commerceColumns.has("error_message")) {
    database.exec("ALTER TABLE commerce_investigations ADD COLUMN error_message TEXT");
  }
  const counterexampleColumns = new Set(
    (database.pragma("table_info(commerce_counterexamples)") as { readonly name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!counterexampleColumns.has("initial_state_json")) {
    database.exec("ALTER TABLE commerce_counterexamples ADD COLUMN initial_state_json TEXT");
  }
  database.exec(`
    UPDATE runs
    SET provenance = COALESCE(
          (SELECT provenance FROM agent_searches WHERE agent_searches.run_id = runs.id),
          provenance
        ),
        model_id = COALESCE(
          (SELECT model_id FROM agent_searches WHERE agent_searches.run_id = runs.id),
          model_id
        ),
        limits_json = COALESCE(
          (SELECT limits_json FROM agent_searches WHERE agent_searches.run_id = runs.id),
          limits_json
        )
    WHERE EXISTS (SELECT 1 FROM agent_searches WHERE agent_searches.run_id = runs.id);
  `);
}

export function recoverUnfinishedRuns(database: AppDatabase, timestamp: string): void {
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
    database
      .prepare(
        "UPDATE usage_reservations SET state = 'ambiguous', updated_at = ? WHERE state = 'reserved'",
      )
      .run(timestamp);
    database
      .prepare(
        "UPDATE policy_translations SET state = 'ambiguous', updated_at = ? WHERE state = 'claimed'",
      )
      .run(timestamp);
    database
      .prepare(
        "UPDATE agent_searches SET status = 'incomplete', updated_at = ? WHERE status = 'claimed'",
      )
      .run(timestamp);
    database
      .prepare(
        "UPDATE commerce_investigations SET state = 'incomplete', updated_at = ? WHERE state = 'claimed'",
      )
      .run(timestamp);
  })();
}
