---
name: Stuck PK sequences
description: Every Supabase table insert must compute MAX(id)+1 explicitly — the PG sequence is behind after seed data was loaded with explicit IDs.
---

# Stuck PK sequences

All integer-PK tables have their PostgreSQL sequences stuck behind the highest seeded ID. Any plain `INSERT` that lets the sequence generate the ID will immediately crash with `duplicate key value violates unique constraint "<table>_pkey"`.

**Why:** Seed data was loaded via Supabase with explicit `id` values, bypassing the sequence. The sequence was never advanced to catch up.

**How to apply:** For every new insert into a table with an integer PK, fetch `MAX(id)` first and use `MAX(id) + 1` as the explicit `id`:

```ts
const { data: maxRow } = await supa
  .from("my_table")
  .select("id")
  .order("id", { ascending: false })
  .limit(1)
  .maybeSingle();
const nextId = ((maxRow as any)?.id ?? 0) + 1;
await supa.from("my_table").insert({ id: nextId, ...payload });
```

**Tables confirmed affected (as of May 2026):**
- `farmers` — fixed in `createFarmer` (db.ts) and dispatch import auto-register
- `input_items` — fixed in dispatch import item resolver
- All others are assumed affected until proven otherwise

**NOT affected:**
- UUID PK tables (`users`, `profiles`) — sequences don't apply
- Tables whose PK is assigned by a DB trigger or DB default expression

**Excel import extra:** Item names from Excel may carry trailing `*` footnote markers. Strip `[*†‡§]+$` before the name-lookup so existing items are matched correctly and no spurious new items are created.
