# Invendis — Inventory & Distribution System

A full-stack web application for managing agricultural input distribution in Sierra Leone. Tracks farmer registry, inventory/warehouse management, distribution campaigns, vehicle dispatch & GPS tracking, Proof of Delivery (PoD), stock reconciliation, reports, and audit logs.

## Architecture

**Monorepo structure (pnpm workspaces):**
- `artifacts/web-portal` — React + Vite frontend (port 21464, preview path `/`)
- `artifacts/api-server` — Express 5 API backend (port 8080, base path `/api`)
- `lib/db` — Drizzle ORM schema + PostgreSQL client
- `lib/api-spec` — OpenAPI spec + orval codegen config
- `lib/api-zod` — Generated Zod validation schemas
- `lib/api-client-react` — Generated React Query hooks + custom fetch
- `scripts` — Utility scripts (seed, etc.)

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Wouter (routing), TanStack Query, shadcn/ui, Tailwind CSS
- **Backend:** Express 5, TypeScript, JWT auth (jsonwebtoken + bcryptjs), pino logging
- **Database:** PostgreSQL via Drizzle ORM
- **Codegen:** Orval (OpenAPI → React Query hooks + Zod schemas)

## Running the Application

Both workflows start automatically:
- **API Server:** `artifacts/api-server: API Server` — builds and starts Express on PORT
- **Web Portal:** `artifacts/web-portal: web` — starts Vite dev server on PORT 21464

## Database

PostgreSQL is provisioned via `DATABASE_URL` environment variable.

**Push schema:** `pnpm --filter @workspace/db run push`
**Seed data:** `pnpm --filter @workspace/scripts run seed`

### Seed Credentials
| Role              | Username    | Password     |
|-------------------|-------------|--------------|
| Admin             | admin       | admin123     |
| Project Manager   | pm.john     | password123  |
| Warehouse Manager | wm.amara    | password123  |
| Field Officer     | fo.fatima   | password123  |
| District Coord.   | dc.ibrahim  | password123  |

## Authentication

JWT-based. Token stored in `localStorage`. The `setAuthTokenGetter` is configured in `main.tsx` to read from `localStorage` and attach `Authorization: Bearer <token>` to all API calls.

Roles: `Admin`, `ProjectManager`, `DistrictCoordinator`, `WarehouseManager`, `FieldOfficer`, `Viewer`

## Modules / Pages

| Route | Description |
|-------|-------------|
| `/login` | Login page |
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
| `/gps-tracking` | Live vehicle GPS tracking |
| `/pod` | Proof of delivery monitoring |
| `/reconciliation` | Stock reconciliation |
| `/reports` | Farmer beneficiary, stock movement, distribution reports |
| `/audit` | Audit log viewer |
| `/users` | User management |
| `/settings` | Master data: districts, value chains, warehouses |

## API Endpoints

All routes require `Authorization: Bearer <token>` header (except `/api/auth/login`).

Key routes:
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Current user
- `GET /api/dashboard/summary` — Dashboard stats
- `GET /api/farmers` — Paginated farmer list
- `POST /api/farmers/:id/approve` — Approve farmer
- `POST /api/farmers/:id/reject` — Reject farmer
- `GET /api/inventory/stock` — Stock balances
- `POST /api/inventory/receive` — Receive stock
- `GET /api/campaigns` — Campaign list
- `POST /api/campaigns/:id/approve` — Approve campaign
- `GET /api/dispatch` — Dispatch manifests
- `POST /api/dispatch/:id/start` — Start dispatch
- `GET /api/pod` — Proof of delivery records
- `GET /api/audit` — Audit logs

## Codegen

Run after changing `lib/api-spec/openapi.yaml`:
```
pnpm --filter @workspace/api-spec run codegen
```

Generated files:
- `lib/api-zod/src/generated/api/api.ts` — Zod schemas
- `lib/api-client-react/src/generated/api.ts` — React Query hooks
- `lib/api-client-react/src/generated/api.schemas.ts` — TypeScript interfaces

## Environment Variables / Secrets

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — JWT signing secret
