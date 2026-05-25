---
name: fieldOfficerId is INTEGER
description: dispatches.field_officer_id is an INTEGER column referencing users.id — not a UUID from profiles.
---

## Rule
`dispatches.field_officer_id` is an **INTEGER** column in PostgreSQL, FK to `users.id` (also integer).

**Why:** Confirmed via live error `invalid input syntax for type integer: "uuid-string"` (PG code 22P02) when a UUID was inserted. profiles.id is UUID but has no relation to this column.

## How to apply
- `listFieldOfficers()` in `db.ts` must query the `users` table (integer `id`), not `profiles`.
- Any INSERT/UPDATE of `field_officer_id` must pass `Number(fieldOfficerId)`, never `String()`.
- `fieldOfficerId` throughout web-portal (`db.ts`, `dispatch.tsx`, `ImportManifestModal`) should be typed as `number`, not `string`.
- The `fetchRelated()` helper in `dispatch.ts` looks up officer names from `users` table (not `profiles`).
