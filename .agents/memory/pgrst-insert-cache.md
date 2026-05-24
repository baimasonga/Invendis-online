---
name: PostgREST stale schema cache — dispatches (and other tables)
description: When supa.from().insert() OR .update() fails "column not found in schema cache", use pool.query() with raw SQL instead. pool connects to Supabase directly, not Replit local PG.
---

## Rule
If a Supabase client INSERT **or UPDATE** fails with "Could not find the '{column}' column of '{table}' in the schema cache", the PostgREST schema cache is stale for that column. This affects **both** INSERT and UPDATE code paths independently — a column stale in INSERT is often also stale in UPDATE.

**The correct fix: use `pool.query()` with raw SQL.** `pool` uses `DATABASE_URL` which is the direct Supabase PostgreSQL connection — it bypasses PostgREST entirely and all columns work.

## Pattern

```ts
// Instead of supa.from('dispatches').insert({...}).update({...}):
const cols = ["manifest_code", "campaign_id", "vehicle_type", "field_officer_id", ...];
const vals: unknown[] = [manifestCode, campaignId, vehicleType, fieldOfficerId, ...];
const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
const sql = `INSERT INTO dispatches (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
const result = await pool.query(sql, vals);
const row = result.rows[0];
```

**Why:** PostgREST maintains a schema cache for each table. Newly-added columns may not appear in this cache until the next PostgREST reload (~33 min default). Both INSERT (POST) and UPDATE (PATCH) routes use separate cache entries; adding a column may leave both stale. `pool.query()` bypasses PostgREST entirely since it connects directly to PostgreSQL.

**Why pool = Supabase:** `DATABASE_URL` env var in api-server points to Supabase's PostgreSQL connection pooler, not Replit's built-in PG. The comment in `supabase.ts` confirms: "Direct pg pool — bypasses PostgREST schema cache entirely. Supabase requires SSL; rejectUnauthorized:false".

**How to apply:** Any supa INSERT or UPDATE that fails with "schema cache". Affects dispatches columns: `vehicle_type`, `field_officer_id`, `hired_plate`, `hired_driver_name`, `notes`. Farmers table has separate stale columns (`beneficiary_type`).

**Do NOT use the two-step INSERT+UPDATE workaround** — if INSERT cache is stale, UPDATE cache is likely stale too for the same columns.
