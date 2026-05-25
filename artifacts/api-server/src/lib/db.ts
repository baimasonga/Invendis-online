// Runtime database access primarily uses the Supabase JS client (./supabase.ts).
// `query` provides a raw-SQL escape hatch via the shared pg Pool for routes
// that need direct INSERT/UPDATE without PostgREST schema-cache interference.

import { pool } from "./supabase.js";
import type { QueryResultRow } from "pg";

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[] }> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return { rows: result.rows };
}
