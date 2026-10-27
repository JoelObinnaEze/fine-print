import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import type Database from "better-sqlite3";

import { parseAction, type Action } from "../../../../packages/engine/src/actions.js";
import { createBottleReturnState } from "../../../../packages/engine/src/scenario.js";
import type { EngineEvent, WorldState } from "../../../../packages/engine/src/types.js";
import { replayActions, type ReplayResult } from "../../../../packages/evaluation/src/replay.js";
import type { Payout } from "../../../../packages/policy/src/receipts.js";
import { parsePolicy, type Policy } from "../../../../packages/policy/src/schema.js";
import { openDatabase } from "../persistence/database.js";
import { initializeRunSchema, recoverUnfinishedRuns } from "../persistence/schema.js";
import type { CreateRunInput } from "./contracts.js";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "infrastructure_error";

export interface RunView {
  readonly id: string;
  readonly status: RunStatus;
  readonly state: WorldState;
  readonly eventCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error: string | null;
}

export type RunEvent =
  | { readonly sequence: number; readonly type: "run.queued"; readonly data: { readonly actionCount: number } }
  | { readonly sequence: number; readonly type: "run.running"; readonly data: Record<string, never> }
  | { readonly sequence: number; readonly type: "engine.event"; readonly data: EngineEvent }
  | { readonly sequence: number; readonly type: "payout"; readonly data: Payout }
  | { readonly sequence: number; readonly type: "run.completed"; readonly data: Record<string, never> }
  | { readonly sequence: number; readonly type: "run.cancelled"; readonly data: Record<string, never> }
  | { readonly sequence: number; readonly type: "run.interrupted"; readonly data: { readonly message: string } }
  | { readonly sequence: number; readonly type: "run.infrastructure_error"; readonly data: { readonly message: string } };

interface StoredRun {
  readonly id: string;
  status: RunStatus;
  state: WorldState;
  readonly policy: Policy;
  readonly actions: readonly Action[];
  readonly events: RunEvent[];
  readonly createdAt: string;
  updatedAt: string;
  error: string | null;
}

interface StoredRunRow {
  readonly id: string;
  readonly status: RunStatus;
  readonly state_json: string;
  readonly policy_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly error: string | null;
}

interface IdempotencyClaimRow {
  readonly request_hash: string;
  readonly run_id: string;
}

type EventListener = (event: RunEvent) => void;

const terminalStatuses = new Set<RunStatus>([
  "completed",
  "cancelled",
  "interrupted",
  "infrastructure_error",
]);

export class RunServiceError extends Error {
  constructor(
    readonly code: "RUN_NOT_FOUND" | "IDEMPOTENCY_KEY_REUSED",
    message: string,
  ) {
    super(message);
    this.name = "RunServiceError";
  }
}

export class RunService {
  readonly #database: Database.Database;
  readonly #runs = new Map<string, StoredRun>();
  readonly #listeners = new Map<string, Set<EventListener>>();
  #isShutDown = false;

  constructor(database: Database.Database = openDatabase(":memory:")) {
    this.#database = database;
    initializeRunSchema(database);
    recoverUnfinishedRuns(database, new Date().toISOString());
  }

  shutdown(): void {
    this.#isShutDown = true;
  }

  create(input: CreateRunInput, idempotencyKey: string): { readonly run: RunView; readonly replayed: boolean } {
    if (this.#isShutDown) throw new Error("Run service is shut down.");
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const policyJson = JSON.stringify(input.policy);
    const policyId = createHash("sha256").update(policyJson).digest("hex");
    const now = new Date().toISOString();
    const initialState = createBottleReturnState();
    const queuedEvent: RunEvent = {
      sequence: 1,
      type: "run.queued",
      data: { actionCount: input.actions.length },
    };
    const run: StoredRun = {
      id: randomUUID(),
      status: "queued",
      state: initialState,
      policy: input.policy,
      actions: input.actions,
      events: [queuedEvent],
      createdAt: now,
      updatedAt: now,
      error: null,
    };

    const createTransaction = this.#database.transaction(() => {
      this.#database
        .prepare("INSERT OR IGNORE INTO policy_versions (id, policy_json, created_at) VALUES (?, ?, ?)")
        .run(policyId, policyJson, now);
      this.#database
        .prepare(`
          INSERT INTO runs
            (id, policy_id, status, initial_state_json, state_json, error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        `)
        .run(run.id, policyId, run.status, JSON.stringify(initialState), JSON.stringify(run.state), now, now);
      const insertAction = this.#database.prepare(
        "INSERT INTO actions (run_id, sequence, action_json) VALUES (?, ?, ?)",
      );
      input.actions.forEach((action, index) => {
        insertAction.run(run.id, index + 1, JSON.stringify(action));
      });
      this.#insertEvent(run.id, queuedEvent);
      this.#database
        .prepare(
          "INSERT INTO idempotency_claims (key, request_hash, run_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(idempotencyKey, requestHash, run.id, now);
    });

    try {
      createTransaction();
    } catch (error) {
      const claim = this.#database
        .prepare("SELECT request_hash, run_id FROM idempotency_claims WHERE key = ?")
        .get(idempotencyKey) as IdempotencyClaimRow | undefined;
      if (!claim) throw error;
      if (claim.request_hash !== requestHash) {
        throw new RunServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was already used with a different request.",
        );
      }
      return { run: this.get(claim.run_id), replayed: true };
    }

    this.#runs.set(run.id, run);
    setImmediate(() => void this.#execute(run.id));
    return { run: this.#view(run), replayed: false };
  }

  get(runId: string): RunView {
    return this.#view(this.#require(runId));
  }

  cancel(runId: string): RunView {
    const run = this.#require(runId);
    if (run.status === "cancelled" || terminalStatuses.has(run.status)) return this.#view(run);
    this.#transition(run, "cancelled", "run.cancelled", {}, null);
    return this.#view(run);
  }

  eventsAfter(runId: string, sequence: number): readonly RunEvent[] {
    return this.#require(runId).events.filter((event) => event.sequence > sequence);
  }

  subscribe(runId: string, listener: EventListener): () => void {
    this.#require(runId);
    const listeners = this.#listeners.get(runId) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(runId);
    };
  }

  async #execute(runId: string): Promise<void> {
    if (this.#isShutDown) return;
    const run = this.#require(runId);
    if (run.status !== "queued") return;

    try {
      this.#transition(run, "running", "run.running", {}, null);
      for (const action of run.actions) {
        await yieldToEventLoop();
        if (this.#isShutDown || !this.#isRunning(run)) return;
        const replay = replayActions(run.state, [action], run.policy);
        this.#persistReplay(run, replay);
        if (run.state.terminal) break;
      }
      if (this.#isShutDown || !this.#isRunning(run)) return;
      this.#transition(run, "completed", "run.completed", {}, null);
    } catch {
      if (terminalStatuses.has(run.status)) return;
      const message = "Run execution failed.";
      try {
        this.#transition(
          run,
          "infrastructure_error",
          "run.infrastructure_error",
          { message },
          message,
        );
      } catch {
        run.status = "infrastructure_error";
        run.error = message;
      }
    }
  }

  #persistReplay(run: StoredRun, replay: ReplayResult): void {
    const events: RunEvent[] = [];
    for (const engineEvent of replay.events) {
      events.push({
        sequence: run.events.length + events.length + 1,
        type: "engine.event",
        data: engineEvent,
      });
    }
    for (const payout of replay.payouts) {
      events.push({
        sequence: run.events.length + events.length + 1,
        type: "payout",
        data: payout,
      });
    }
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .prepare("UPDATE runs SET state_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(replay.state), now, run.id);
      for (const event of events) this.#insertEvent(run.id, event);
      const insertPayout = this.#database.prepare(`
        INSERT INTO payouts
          (run_id, event_sequence, clause_id, item_id, amount, predicate_results_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const payout of replay.payouts) {
        insertPayout.run(
          run.id,
          payout.eventSequence,
          payout.clauseId,
          payout.itemId,
          payout.amount,
          JSON.stringify(payout.predicateResults),
        );
      }
    })();
    run.state = replay.state;
    run.updatedAt = now;
    for (const event of events) this.#publish(run, event);
  }

  #isRunning(run: StoredRun): boolean {
    return run.status === "running";
  }

  #transition<T extends Extract<RunEvent, { readonly type: `run.${string}` }>["type"]>(
    run: StoredRun,
    status: RunStatus,
    type: T,
    data: Extract<RunEvent, { readonly type: T }>["data"],
    error: string | null,
  ): void {
    const event = {
      sequence: run.events.length + 1,
      type,
      data,
    } as RunEvent;
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
        .run(status, error, now, run.id);
      this.#insertEvent(run.id, event);
    })();
    run.status = status;
    run.error = error;
    run.updatedAt = now;
    this.#publish(run, event);
  }

  #insertEvent(runId: string, event: RunEvent): void {
    this.#database
      .prepare("INSERT INTO events (run_id, sequence, type, data_json) VALUES (?, ?, ?, ?)")
      .run(runId, event.sequence, event.type, JSON.stringify(event.data));
  }

  #require(runId: string): StoredRun {
    const cached = this.#runs.get(runId);
    if (cached) return cached;
    const row = this.#database
      .prepare(`
        SELECT runs.id, runs.status, runs.state_json, runs.created_at, runs.updated_at, runs.error,
               policy_versions.policy_json
        FROM runs
        JOIN policy_versions ON policy_versions.id = runs.policy_id
        WHERE runs.id = ?
      `)
      .get(runId) as StoredRunRow | undefined;
    if (!row) throw new RunServiceError("RUN_NOT_FOUND", "Run was not found.");
    const actions = this.#database
      .prepare("SELECT action_json FROM actions WHERE run_id = ? ORDER BY sequence")
      .all(runId) as { readonly action_json: string }[];
    const storedEvents = this.#database
      .prepare("SELECT sequence, type, data_json FROM events WHERE run_id = ? ORDER BY sequence")
      .all(runId) as { readonly sequence: number; readonly type: RunEvent["type"]; readonly data_json: string }[];
    const run: StoredRun = {
      id: row.id,
      status: row.status,
      state: JSON.parse(row.state_json) as WorldState,
      policy: parsePolicy(JSON.parse(row.policy_json)),
      actions: actions.map((action) => parseAction(JSON.parse(action.action_json))),
      events: storedEvents.map(
        (event) => ({ sequence: event.sequence, type: event.type, data: JSON.parse(event.data_json) }) as RunEvent,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error,
    };
    this.#runs.set(runId, run);
    return run;
  }

  #view(run: StoredRun): RunView {
    return {
      id: run.id,
      status: run.status,
      state: run.state,
      eventCount: run.events.length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      error: run.error,
    };
  }

  #publish(run: StoredRun, event: RunEvent): void {
    run.events.push(event);
    for (const listener of this.#listeners.get(run.id) ?? []) {
      try {
        listener(event);
      } catch {
        this.#listeners.get(run.id)?.delete(listener);
      }
    }
  }
}
