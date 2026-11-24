// Thin wrapper over node:sqlite. Each database passes its own schema (see server/project/schema.ts, server/hub/hub-db.ts).

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string, schema: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(schema);
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]): void {
    this.raw.prepare(sql).run(...params);
  }

  /** INSERT OR REPLACE a plain object; objects/arrays are stored as JSON. */
  upsert(table: string, row: Record<string, unknown>): void {
    const keys = Object.keys(row);
    const values = keys.map((k) => toSql(row[k]));
    this.raw.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...values);
  }

  /** Adds a column to an existing table if it is missing (schemas only CREATE IF NOT EXISTS). */
  ensureColumn(table: string, column: string, ddl: string): void {
    const cols = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }

  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export function toSql(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v as SQLInputValue;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
