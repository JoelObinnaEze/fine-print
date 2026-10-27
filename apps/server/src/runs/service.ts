import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { createBottleReturnState } from "../../../../packages/engine/src/scenario.js";
import type { EngineEvent, WorldState } from "../../../../packages/engine/src/types.js";
import { replayActions } from "../../../../packages/evaluation/src/replay.js";
import type { Payout } from "../../../../packages/policy/src/receipts.js";
import type { Policy } from "../../../../packages/policy/src/schema.js";
import type { Action } from "../../../../packages/engine/src/actions.js";

import type { CreateRunInput } from "./contracts.js";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
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

interface IdempotencyClaim {
  readonly requestHash: string;
  readonly runId: string;
}

type EventListener = (event: RunEvent) => void;

const terminalStatuses = new Set<RunStatus>(["completed", "cancelled", "infrastructure_error"]);

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
  readonly #runs = new Map<string, StoredRun>();
  readonly #claims = new Map<string, IdempotencyClaim>();
  readonly #listeners = new Map<string, Set<EventListener>>();

  create(input: CreateRunInput, idempotencyKey: string): { readonly run: RunView; readonly replayed: boolean } {
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.#claims.get(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new RunServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key was already used with a different request.",
        );
      }
      return { run: this.get(existing.runId), replayed: true };
    }

    const now = new Date().toISOString();
    const run: StoredRun = {
      id: randomUUID(),
      status: "queued",
      state: createBottleReturnState(),
      policy: input.policy,
      actions: input.actions,
      events: [],
      createdAt: now,
      updatedAt: now,
      error: null,
    };
    this.#runs.set(run.id, run);
    this.#claims.set(idempotencyKey, { requestHash, runId: run.id });
    this.#emit(run, "run.queued", { actionCount: run.actions.length });
    setImmediate(() => void this.#execute(run.id));
    return { run: this.#view(run), replayed: false };
  }

  get(runId: string): RunView {
    return this.#view(this.#require(runId));
  }

  cancel(runId: string): RunView {
    const run = this.#require(runId);
    if (run.status === "cancelled") return this.#view(run);
    if (terminalStatuses.has(run.status)) return this.#view(run);
    run.status = "cancelled";
    this.#emit(run, "run.cancelled", {});
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
    const run = this.#require(runId);
    if (run.status !== "queued") return;
    run.status = "running";
    this.#emit(run, "run.running", {});

    try {
      for (const action of run.actions) {
        await yieldToEventLoop();
        if (run.status !== "running") return;
        const replay = replayActions(run.state, [action], run.policy);
        run.state = replay.state;
        for (const event of replay.events) this.#emit(run, "engine.event", event);
        for (const payout of replay.payouts) this.#emit(run, "payout", payout);
        if (run.state.terminal) break;
      }
      if (run.status !== "running") return;
      run.status = "completed";
      this.#emit(run, "run.completed", {});
    } catch {
      run.status = "infrastructure_error";
      run.error = "Run execution failed.";
      this.#emit(run, "run.infrastructure_error", { message: run.error });
    }
  }

  #require(runId: string): StoredRun {
    const run = this.#runs.get(runId);
    if (!run) throw new RunServiceError("RUN_NOT_FOUND", "Run was not found.");
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

  #emit<T extends RunEvent["type"]>(
    run: StoredRun,
    type: T,
    data: Extract<RunEvent, { readonly type: T }>["data"],
  ): void {
    const event = { sequence: run.events.length + 1, type, data } as RunEvent;
    run.events.push(event);
    run.updatedAt = new Date().toISOString();
    for (const listener of this.#listeners.get(run.id) ?? []) {
      try {
        listener(event);
      } catch {
        this.#listeners.get(run.id)?.delete(listener);
      }
    }
  }
}
