import { randomUUID } from "node:crypto";

import type { ServerConfig } from "../config.js";
import type { AppDatabase } from "../persistence/database.js";
import { initializeRunSchema } from "../persistence/schema.js";

type ReservationState = "reserved" | "settled" | "ambiguous" | "released";

interface ReservationRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly scope_id: string;
  readonly reserved_micros: number;
  readonly actual_micros: number | null;
  readonly state: ReservationState;
}

export interface UsageReservation {
  readonly id: string;
  readonly runId: string | null;
  readonly scopeId: string;
  readonly reservedUsd: number;
  readonly state: ReservationState;
}

export interface BudgetUsage {
  readonly appBudgetUsd: number;
  readonly sessionBudgetUsd: number;
  readonly reservedUsd: number;
  readonly settledUsd: number;
  readonly ambiguousUsd: number;
  readonly availableAppUsd: number;
  readonly availableSessionUsd: number;
}

export type ReservationSettlement =
  | { readonly state: "settled"; readonly actualUsd: number }
  | { readonly state: "ambiguous" }
  | { readonly state: "released" };

export class BudgetServiceError extends Error {
  constructor(
    readonly code: "LIVE_DISABLED" | "INVALID_RESERVATION" | "BUDGET_EXCEEDED" | "RESERVATION_NOT_FOUND" | "RESERVATION_FINAL",
    message: string,
  ) {
    super(message);
    this.name = "BudgetServiceError";
  }
}

function toMicros(value: number, allowZero = false): number {
  // Fractional microdollars round up so reservations never undercount cost.
  const micros = Math.ceil(value * 1_000_000);
  if (!Number.isFinite(value) || value < 0 || (!allowZero && micros <= 0)) {
    throw new BudgetServiceError("INVALID_RESERVATION", "Reservation amount is invalid.");
  }
  return micros;
}

function fromMicros(value: number): number {
  return Number((value / 1_000_000).toFixed(6));
}

const chargedMicros = `
  CASE
    WHEN state = 'settled' THEN COALESCE(actual_micros, reserved_micros)
    WHEN state IN ('reserved', 'ambiguous') THEN reserved_micros
    ELSE 0
  END
`;

export function emptyBudgetUsage(config: ServerConfig): BudgetUsage {
  return {
    appBudgetUsd: config.budgets.effectiveAppUsd,
    sessionBudgetUsd: config.budgets.sessionUsd,
    reservedUsd: 0,
    settledUsd: 0,
    ambiguousUsd: 0,
    availableAppUsd: config.budgets.effectiveAppUsd,
    availableSessionUsd: Math.min(config.budgets.sessionUsd, config.budgets.effectiveAppUsd),
  };
}

export class BudgetService {
  readonly #database: AppDatabase;
  readonly #config: ServerConfig;
  readonly #sessionId: string;
  #providerRequestInFlight = false;

  constructor(
    database: AppDatabase,
    config: ServerConfig,
    sessionId: string = randomUUID(),
  ) {
    this.#database = database;
    this.#config = config;
    this.#sessionId = sessionId;
    initializeRunSchema(this.#database);
  }

  reserve(input: {
    readonly runId: string | null;
    readonly scopeId: string;
    readonly estimatedUsd: number;
  }): UsageReservation {
    if (!this.#config.liveAgent.isEnabled) {
      throw new BudgetServiceError("LIVE_DISABLED", "Live provider usage is disabled.");
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.scopeId)) {
      throw new BudgetServiceError("INVALID_RESERVATION", "Reservation scope is invalid.");
    }
    const reservedMicros = toMicros(input.estimatedUsd);
    const appLimit = toMicros(this.#config.budgets.effectiveAppUsd);
    const sessionLimit = toMicros(this.#config.budgets.sessionUsd);
    const searchLimit = toMicros(this.#config.budgets.searchUsd);

    const transaction = this.#database.transaction(() => {
      const appUsed = this.#sum(`SELECT COALESCE(SUM(${chargedMicros}), 0) AS total FROM usage_reservations`);
      const sessionUsed = this.#sum(
        `SELECT COALESCE(SUM(${chargedMicros}), 0) AS total FROM usage_reservations WHERE session_id = ?`,
        this.#sessionId,
      );
      const searchUsed = this.#sum(
        `SELECT COALESCE(SUM(${chargedMicros}), 0) AS total FROM usage_reservations WHERE session_id = ? AND scope_id = ?`,
        this.#sessionId,
        input.scopeId,
      );
      if (appUsed + reservedMicros > appLimit) {
        throw new BudgetServiceError("BUDGET_EXCEEDED", "Reservation exceeds the app budget.");
      }
      if (sessionUsed + reservedMicros > sessionLimit) {
        throw new BudgetServiceError("BUDGET_EXCEEDED", "Reservation exceeds the session budget.");
      }
      if (searchUsed + reservedMicros > searchLimit) {
        throw new BudgetServiceError("BUDGET_EXCEEDED", "Reservation exceeds the search budget.");
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      this.#database
        .prepare(`
          INSERT INTO usage_reservations
            (id, run_id, session_id, scope_id, reserved_micros, actual_micros, state, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, 'reserved', ?, ?)
        `)
        .run(id, input.runId, this.#sessionId, input.scopeId, reservedMicros, now, now);
      return {
        id,
        runId: input.runId,
        scopeId: input.scopeId,
        reservedUsd: fromMicros(reservedMicros),
        state: "reserved" as const,
      };
    });
    return transaction.immediate();
  }

  claimProviderRequest(): (() => void) | null {
    if (this.#providerRequestInFlight) return null;
    this.#providerRequestInFlight = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#providerRequestInFlight = false;
    };
  }

  settle(reservationId: string, settlement: ReservationSettlement): UsageReservation {
    const transaction = this.#database.transaction(() => {
      const row = this.#database
        .prepare(
          "SELECT id, run_id, scope_id, reserved_micros, actual_micros, state FROM usage_reservations WHERE id = ?",
        )
        .get(reservationId) as ReservationRow | undefined;
      if (!row) {
        throw new BudgetServiceError("RESERVATION_NOT_FOUND", "Usage reservation was not found.");
      }
      if (row.state !== "reserved") {
        throw new BudgetServiceError("RESERVATION_FINAL", "Usage reservation is already final.");
      }

      const actualMicros = settlement.state === "settled" ? toMicros(settlement.actualUsd, true) : null;
      if (actualMicros !== null && actualMicros > row.reserved_micros) {
        throw new BudgetServiceError(
          "INVALID_RESERVATION",
          "Actual usage cannot exceed the reserved amount.",
        );
      }
      this.#database
        .prepare("UPDATE usage_reservations SET state = ?, actual_micros = ?, updated_at = ? WHERE id = ?")
        .run(settlement.state, actualMicros, new Date().toISOString(), reservationId);
      return {
        id: row.id,
        runId: row.run_id,
        scopeId: row.scope_id,
        reservedUsd: fromMicros(row.reserved_micros),
        state: settlement.state,
      };
    });
    return transaction.immediate();
  }

  getUsage(): BudgetUsage {
    const breakdown = this.#database
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN state = 'reserved' THEN reserved_micros ELSE 0 END), 0) AS reserved,
          COALESCE(SUM(CASE WHEN state = 'settled' THEN actual_micros ELSE 0 END), 0) AS settled,
          COALESCE(SUM(CASE WHEN state = 'ambiguous' THEN reserved_micros ELSE 0 END), 0) AS ambiguous
        FROM usage_reservations
      `)
      .get() as { readonly reserved: number; readonly settled: number; readonly ambiguous: number };
    const appUsed = breakdown.reserved + breakdown.settled + breakdown.ambiguous;
    const sessionUsed = this.#sum(
      `SELECT COALESCE(SUM(${chargedMicros}), 0) AS total FROM usage_reservations WHERE session_id = ?`,
      this.#sessionId,
    );
    return {
      appBudgetUsd: this.#config.budgets.effectiveAppUsd,
      sessionBudgetUsd: this.#config.budgets.sessionUsd,
      reservedUsd: fromMicros(breakdown.reserved),
      settledUsd: fromMicros(breakdown.settled),
      ambiguousUsd: fromMicros(breakdown.ambiguous),
      availableAppUsd: fromMicros(
        Math.max(0, toMicros(this.#config.budgets.effectiveAppUsd, true) - appUsed),
      ),
      availableSessionUsd: fromMicros(
        Math.max(
          0,
          Math.min(
            toMicros(this.#config.budgets.sessionUsd, true) - sessionUsed,
            toMicros(this.#config.budgets.effectiveAppUsd, true) - appUsed,
          ),
        ),
      ),
    };
  }

  #sum(sql: string, ...parameters: readonly unknown[]): number {
    return (
      this.#database.prepare(sql).get(...parameters) as { readonly total: number }
    ).total;
  }
}
