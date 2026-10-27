import { DatabaseSync, type StatementSync } from "node:sqlite";

interface Statement {
  run(...parameters: readonly unknown[]): unknown;
  get(...parameters: readonly unknown[]): unknown;
  all(...parameters: readonly unknown[]): readonly unknown[];
}

interface Transaction<T> {
  (): T;
  immediate(): T;
}

function bind(statement: StatementSync): Statement {
  return {
    run: (...parameters) => statement.run(...(parameters as never[])),
    get: (...parameters) => statement.get(...(parameters as never[])),
    all: (...parameters) => statement.all(...(parameters as never[])),
  };
}

export class AppDatabase {
  readonly #database: DatabaseSync;
  readonly name: string;

  constructor(path: string) {
    this.name = path;
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  get open(): boolean {
    return this.#database.isOpen;
  }

  close(): void {
    this.#database.close();
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  prepare(sql: string): Statement {
    return bind(this.#database.prepare(sql));
  }

  pragma(sql: string): readonly unknown[];
  pragma(sql: string, options: { readonly simple: true }): unknown;
  pragma(sql: string, options?: { readonly simple: true }): unknown {
    if (sql.includes("=")) {
      this.#database.exec(`PRAGMA ${sql}`);
      return [];
    }
    const rows = this.#database.prepare(`PRAGMA ${sql}`).all();
    if (!options?.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  transaction<T>(operation: () => T): Transaction<T> {
    const execute = (mode: "" | " IMMEDIATE") => {
      this.#database.exec(`BEGIN${mode}`);
      try {
        const result = operation();
        this.#database.exec("COMMIT");
        return result;
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    };
    const deferred = () => execute("");
    deferred.immediate = () => execute(" IMMEDIATE");
    return deferred;
  }
}

export function openDatabase(path: string): AppDatabase {
  return new AppDatabase(path);
}
