import { mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import { DB_PATH, DATABASE_URL } from "./settings";

/**
 * Tiny SQL adapter so the same queries run on:
 *  - Postgres (Neon, over HTTP) when DATABASE_URL is set: used on Vercel;
 *  - SQLite (better-sqlite3, loaded lazily) otherwise: local dev and tests.
 * Queries use `?` placeholders (rewritten to $1.. for Postgres) and portable SQL only.
 */
export interface Sql {
  kind: "postgres" | "sqlite";
  all<T = Record<string, unknown>>(q: string, params?: unknown[]): Promise<T[]>;
  run(q: string, params?: unknown[]): Promise<{ changes: number }>;
  close?(): void;
}

const toPg = (q: string) => { let i = 0; return q.replace(/\?/g, () => `$${++i}`); };
const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]); // int8, int2, int4, float4, float8, numeric

function postgres(url: string): Sql {
  const sql = neon(url, { fullResults: true });
  const exec = async (q: string, params: unknown[] = []) => {
    const r = await sql.query(toPg(q), params as never[]);
    const numeric = r.fields.filter((f) => NUMERIC_OIDS.has(f.dataTypeID)).map((f) => f.name);
    const rows = (r.rows as Record<string, unknown>[]).map((row) => {
      for (const k of numeric) if (row[k] !== null && row[k] !== undefined) row[k] = Number(row[k]);
      return row;
    });
    return { rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    kind: "postgres",
    all: async (q, p) => (await exec(q, p)).rows as never[],
    run: async (q, p) => ({ changes: (await exec(q, p)).rowCount }),
  };
}

async function sqlite(file: string): Promise<Sql> {
  const Database = (await import("better-sqlite3")).default;
  if (file !== ":memory:") mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 3000");
  return {
    kind: "sqlite",
    all: async (q, p = []) => d.prepare(q).all(...p) as never[],
    run: async (q, p = []) => ({ changes: d.prepare(q).run(...p).changes }),
    close: () => d.close(),
  };
}

export async function openSql(file?: string): Promise<Sql> {
  if (!file && DATABASE_URL) return postgres(DATABASE_URL);
  return sqlite(file ?? DB_PATH);
}
