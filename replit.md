# Invendis — Inventory & Distribution System

A full-stack web application for managing agricultural input distribution in Sierra Leone. Tracks farmer registry, inventory/warehouse management, distribution campaigns, vehicle dispatch & GPS tracking, Proof of Delivery (PoD), stock reconciliation, reports, and audit logs.

## Architecture

**Monorepo structure (pnpm workspaces):**
- `artifacts/web-portal` — React + Vite frontend (port 21464, preview path `/`)
- `artifacts/api-server` — Express 5 API backend (port 8080, base path `/api`)
- `lib/db` — Drizzle ORM schema + PostgreSQL client
- `lib/api-spec` — OpenAPI spec + orval codegen config
- `lib/api-zod` — Generated Zod validation schemas
- `scripts` — Utility scripts (seed, etc.)

> **Note:** `lib/api-client-react` is no longer used by the web-portal. All data fetching is done directly via `artifacts/web-portal/src/lib/db.ts` (direct Supabase calls) combined with `useQuery`/`useMutation` from `@tanstack/react-query`. The generated hooks package still exists in the repo but is not a dependency of the web-portal.

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Wouter (routing), TanStack Query v5, shadcn/ui, Tailwind CSS
- **Backend:** Express 5, TypeScript, Supabase Auth, pino logging
- **Database:** PostgreSQL (Supabase) via Drizzle ORM + direct Supabase client in `db.ts`
- **Auth:** Supabase Auth (`signInWithPassword`) — email + password

## Data Layer Pattern (web-portal)

All frontend data fetching goes through `src/lib/db.ts`:

```ts
// Query example
const { data } = useQuery({
  queryKey: KEYS.farmers(page, search),
  queryFn: () => listFarmers(page, limit, search),
});

// Mutation example
const create = useMutation({ mutationFn: createFarmer });
await create.mutateAsync({ firstName, lastName, ... });
await qc.invalidateQueries({ queryKey: KEYS.farmers() });
```

Key facts about `db.ts`:
- `listVehicles(page, limit)` / `listDrivers(page, limit)` → `{ data, total }` (paginated)
- `listReconciliations()` / `listProcurementOrders()` / `listWarehouses()` / `listDistricts()` / `listValueChains()` / `listInputItems()` → plain arrays
- `listVehicleGpsStatus()` / `listGpsTrack(vehicleId?, limit?)` → plain arrays
- `activateUser(id: string)` / `deactivateUser(id: string)` — user IDs are UUID strings (Supabase)
- `createUser({ email, password, fullName, role })` — email is required (Supabase signUp)
- `getFarmerBeneficiaryReport()` → `{ rows: [{district, total, approved, pending, female}], summary: {total, approved, female, pctApproved} }`
- `getStockMovementReport()` → `[{ txnType, createdAt, itemName, warehouseName, quantity }]`
- `getDistributionReport()` → `[{ manifestCode, campaignName, warehouseName, status, completionPct }]`

## Running the Application

Both workflows start automatically:
- **API Server:** `artifacts/api-server: API Server` — Express on PORT
- **Web Portal:** `artifacts/web-portal: web` — Vite dev server on PORT

## Database

PostgreSQL is provisioned via Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

**Push schema:** `pnpm --filter @workspace/db run push`
**Seed data:** `pnpm --filter @workspace/scripts run seed`

### Seed Credentials (email login)
| Role              | Email                      | Password     |
|-------------------|----------------------------|--------------|
| Admin             | admin@invendis.sl          | admin123     |
| Project Manager   | pm.john@invendis.sl        | password123  |
| Warehouse Manager | wm.amara@invendis.sl       | password123  |
| Field Officer     | fo.fatima@invendis.sl      | password123  |

## Authentication

Supabase Auth — `signInWithPassword({ email, password })`. Session is maintained by the Supabase client automatically. The `AuthProvider` in `use-auth.tsx` wraps the app and exposes `login`, `logout`, `user`, `isAuthenticated`.

Roles: `Admin`, `ProjectManager`, `DistrictCoordinator`, `WarehouseManager`, `FieldOfficer`, `Viewer`

## Modules / Pages

| Route | Description |
|-------|-------------|
| `/login` | Login (email + password) |
| `/dashboard` | Summary cards + charts |
| `/farmers` | Farmer registry with search/filter |
| `/farmers/:id` | Farmer detail, approve/reject, QR code |
| `/inventory` | Input catalogue + stock balances |
| `/procurement` | Procurement orders |
| `/campaigns` | Distribution campaigns |
| `/campaigns/:id` | Campaign detail + allocations |
| `/allocations` | Farmer allocation management |
| `/vehicles` | Vehicle + driver registry |
| `/dispatch` | Dispatch manifests |
| `/dispatch/:id` | Dispatch detail + manifest items |
| `/gps-tracking` | Live vehicle GPS tracking (30s refresh) |
| `/pod` | Proof of delivery monitoring |
| `/reconciliation` | Stock reconciliation |
| `/reports` | Beneficiary (district-level), stock movement, distribution reports |
| `/audit` | Audit log viewer (paginated) |
| `/users` | User management (activate/deactivate) |
| `/settings` | Master data: districts, value chains, warehouses |

## Environment Variables / Secrets

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (used in web-portal)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (used in api-server)
- `SESSION_SECRET` — Session/JWT signing secret
- `DATABASE_URL` — Direct PostgreSQL connection string (api-server + drizzle)
