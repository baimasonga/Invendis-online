import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supa = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ── Case converters ───────────────────────────────────────────────────────────

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function snakeToCamel<T = Record<string, unknown>>(obj: unknown): T {
  if (Array.isArray(obj)) return obj.map(snakeToCamel) as unknown as T;
  if (obj && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [toCamel(k), snakeToCamel(v)])
    ) as T;
  }
  return obj as T;
}

export function camelToSnake(obj: unknown): Record<string, unknown> {
  if (Array.isArray(obj)) return obj.map(camelToSnake) as unknown as Record<string, unknown>;
  if (obj && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [toSnake(k), v instanceof Date ? v.toISOString() : v])
    );
  }
  return obj as Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function supaCount(table: string, filters: Record<string, unknown> = {}): Promise<number> {
  let q = supa.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) q = q.eq(k, v) as typeof q;
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
