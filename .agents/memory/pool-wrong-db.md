---
name: pool connects to wrong database
description: DATABASE_URL (pool) is Replit local PostgreSQL, NOT Supabase. Never use pool for app data. pod INSERT now uses supa.
---

## Rule
**Never use `pool.query()` for application data operations.** `pool` (pg.Pool) connects to `DATABASE_URL` which is the Replit local PostgreSQL — a separate empty database. All real app data lives in Supabase.

**Why:** `pool.query()` to insert dispatches caused FK violations like `Key (campaign_id)=(2) is not present in table "campaigns"` because campaigns were created via `supa` (Supabase) while dispatches were inserted into the Replit local DB. Confirmed again when pod INSERT via `pool.query` meant zero PoDs ever reached Supabase.

## How to apply
- All SELECT/INSERT/UPDATE/DELETE for app data must use `supa` (Supabase JS client).
- The comment "use pool to bypass PostgREST schema cache" was wrong — it hits the wrong database.
- `pool` should only be used for schema migrations via Drizzle, never for runtime data operations.
- `dispatch.ts`: all pool.query calls already replaced with supa.
- `pod.ts`: pool.query INSERT + duplicate UPDATE replaced with supa.from('pod').insert().

## Schema cache fallback pattern (pod.ts)

If PostgREST rejects a newer column on INSERT ("Could not find" / PGRST204):
1. Insert base columns only (known-good set)
2. Immediately UPDATE the extended columns on the returned row id

```ts
const { data, error } = await supa.from("pod").insert(insertFields).select().single();
if (error?.message?.includes("Could not find") || error?.code === "PGRST204") {
  const baseData = Object.fromEntries(Object.entries(insertFields).filter(([k]) => BASE_COLS.has(k)));
  const { data: base } = await supa.from("pod").insert(baseData).select().single();
  // then UPDATE extended columns using base.id
}
```
