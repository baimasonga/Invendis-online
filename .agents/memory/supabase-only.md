---
name: Data store — Supabase only
description: All application data lives in Supabase. The Replit PostgreSQL (DATABASE_URL / executeSql) is migrations-only and must never be used for app data operations.
---

# All app data lives in Supabase — never the Replit PostgreSQL

## The rule
Every read, write, and delete of app data (farmers, dispatches, campaigns, stock, users, etc.) must go through Supabase — either the Supabase JS client or the Supabase REST API. The Replit PostgreSQL is schema-migration storage only.

**Why:** DATABASE_URL points to a local Replit PostgreSQL instance used exclusively by Drizzle to run and track migrations. The app itself reads and writes exclusively to Supabase (SUPABASE_URL). The two databases share the same schema but hold completely different data. Operating on the wrong one silently succeeds while leaving the visible app unchanged — exactly what caused the "farmers still showing" incident during the production reset.

## How to apply

| Task | Correct tool |
|------|-------------|
| Schema migrations | `pnpm --filter @workspace/db run push` (uses DATABASE_URL → Replit PostgreSQL) |
| Read/write app data | Supabase JS client (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`) |
| Bulk data deletion / admin ops | Supabase REST API via `curl $SUPABASE_URL/rest/v1/<table>?filter` with service-role key |
| One-off data queries | Supabase REST API or JS client — NOT `executeSql` |
| `executeSql` (code_execution tool) | Only for schema inspection or Drizzle-managed migration checks. Never for app data. |

## Supabase REST delete pattern (all rows)
```bash
curl -s -X DELETE "${SUPABASE_URL}/rest/v1/<table>?id=gte.0" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Prefer: return=minimal"
# 204 = success
```

## Supabase Auth admin operations
Auth users (`auth.users`) are NOT in the public schema and cannot be reached via SQL or the REST API. Use the Auth Admin API:
```bash
# List users
curl "${SUPABASE_URL}/auth/v1/admin/users?per_page=100" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# Delete a user by UUID
curl -X DELETE "${SUPABASE_URL}/auth/v1/admin/users/<uuid>" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```
