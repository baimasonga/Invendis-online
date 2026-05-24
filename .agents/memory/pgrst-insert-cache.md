---
name: PostgREST stale INSERT schema cache
description: Workaround when supa.from().insert() fails with "column not found in schema cache" but the column works fine in SELECT/UPDATE.
---

## Rule
If a Supabase client INSERT fails with "Could not find the '{column}' column of '{table}' in the schema cache" but SELECT queries using that same column work fine, the PostgREST INSERT schema cache is stale.

**Do NOT use `pool` (DATABASE_URL) to bypass this — pool connects to Replit's local PostgreSQL, not Supabase.**

## Workaround
Two-step approach:
1. INSERT without the problematic column — the column must have a DB-level DEFAULT so the row is valid.
2. Immediately UPDATE to set the column to the desired value.

```ts
const { data, error } = await supa.from("farmers")
  .insert({ /* all cols except beneficiary_type */ })
  .select("id").single();
// beneficiary_type defaults to 'individual' via DB default
await supa.from("farmers").update({ beneficiary_type: "group" }).eq("id", data.id);
```

**Why:** PostgREST maintains separate schema cache entries for readable vs insertable columns. A newly-added column may appear in reads before the INSERT cache is refreshed (default refresh ~33 min). UPDATE goes through a different code path and is not affected.

**How to apply:** Any time a supa INSERT fails with "schema cache" for a column that clearly exists (you can SELECT it). Also applies when adding new columns to tables with existing PostgREST cache.
