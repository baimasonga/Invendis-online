---
name: pool connects to wrong database
description: DATABASE_URL (pool) is Replit local PostgreSQL, NOT Supabase. Never use pool for app data in dispatch.ts or any route.
---

## Rule
**Never use `pool.query()` for application data operations.** `pool` (pg.Pool) connects to `DATABASE_URL` which is the Replit local PostgreSQL — a separate empty database that holds only schema (used for Drizzle migrations). All real app data lives in Supabase.

**Why:** `pool.query()` to insert dispatches caused FK violations like `Key (campaign_id)=(2) is not present in table "campaigns"` because campaigns were created via `supa` (Supabase) while dispatches were inserted into the Replit local DB (no campaigns there). Confirmed by live test showing HTTP 500 with `23503` FK constraint error.

## How to apply
- All SELECT/INSERT/UPDATE/DELETE for app data must use `supa` (Supabase JS client).
- The workaround "use pool to bypass PostgREST schema cache" was wrong — it hits the wrong database.
- For columns that PostgREST schema cache may not expose (e.g. `field_officer_id`): use the two-step INSERT+UPDATE pattern (insert without the column, then immediately UPDATE it).
- `pool` should only be used for schema migrations via Drizzle, never for runtime data operations.
- dispatch.ts was fixed: all 6 `pool.query()` calls replaced with `supa` equivalents. The `pool` import was removed from dispatch.ts entirely.
