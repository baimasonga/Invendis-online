# Invendis — Inventory & Distribution System

A full-stack web application + mobile field app for managing agricultural input distribution in Sierra Leone. Tracks farmer registry, inventory/warehouse management, distribution campaigns, vehicle dispatch & GPS tracking, Proof of Delivery (PoD), stock reconciliation, reports, and audit logs.

## Architecture

**Monorepo structure (pnpm workspaces):**
- `artifacts/web-portal` — React + Vite frontend (port 21464, preview path `/`)
- `artifacts/api-server` — Express 5 API backend (port 8080, base path `/api`)
- `artifacts/field-app` — Expo React Native mobile app (port 24635, preview path `/field-app/`)
- `lib/db` — Drizzle ORM schema + PostgreSQL client
- `lib/api-spec` — OpenAPI spec + orval codegen config
- `lib/api-zod` — Generated Zod validation schemas
- `scripts` — Utility scripts (seed, etc.)

> **Note:** `lib/api-client-react` is no longer used by the web-portal. All data fetching is done directly via `artifacts/web-portal/src/lib/db.ts` (direct Supabase calls) combined with `useQuery`/`useMutation` from `@tanstack/react-query`. The generated hooks package still exists in the repo but is not a dependency of the web-portal.

## Tech Stack

- **Web Frontend:** React 18, Vite, TypeScript, Wouter (routing), TanStack Query v5, shadcn/ui, Tailwind CSS
- **Mobile App:** Expo (React Native), Expo Router, TanStack Query v5, expo-camera, expo-location, AsyncStorage
- **Backend:** Express 5, TypeScript, bcrypt+JWT auth, pino logging
- **Database:** PostgreSQL (Supabase) via Drizzle ORM + direct Supabase client in `db.ts`
- **Web Auth:** Supabase Auth (`signInWithPassword`) — email + password
- **Mobile Auth:** Custom JWT (`POST /api/auth/login` returns token, stored in AsyncStorage)

## Mobile Field App (`artifacts/field-app`)

Expo app for field officers to:
- **Login** — JWT auth via `POST /api/auth/login` (same credentials as web portal)
- **Dashboard** — Today's PoD count, pending sync queue, active dispatches
- **Dispatch tab** — Browse/filter active dispatches, tap to view detail
- **Scan tab** — Camera barcode/QR scan OR manual search to look up farmers
- **Distribution detail** — Manifest info, items loaded, submitted PoDs
- **Confirm PoD** — Farmer info, GPS capture, quantity, notes → submit or save offline
- **Incidents tab** — Report field incidents (stored locally in AsyncStorage)
- **Sync tab** — Offline queue management; sync pending PoDs when connected

### Key Files (field-app)
- `context/AuthContext.tsx` — JWT auth state, backed by AsyncStorage `@auth`
- `context/OfflineQueueContext.tsx` — PoD offline queue in AsyncStorage `@pod_queue`
- `lib/api.ts` — Typed API helpers using `EXPO_PUBLIC_DOMAIN`
- `app/_layout.tsx` — Root layout with providers + auth guard redirect
- `app/(tabs)/_layout.tsx` — 5-tab bar (Home, Dispatch, Scan, Incidents, Sync)
- `app/confirm-pod.tsx` — 3-step PoD flow: Details → OTP → Face Verification
- `app/scan-farmer.tsx` — Camera barcode scanner + manual search

### Confirm PoD Flow (3 steps)
1. **Details** — quantity, GPS, notes
2. **OTP** — WhatsApp/SMS 6-digit code with dev-mode bypass banner
3. **Face Verification** — camera photo → S3 upload → AWS Rekognition CompareFaces

### API Routes
- `GET /api/farmers/barcode/:token` — Look up farmer by `barcodeToken`
- `POST /api/face/upload-url` — Get presigned S3 URL for photo upload
- `GET /api/face/view-url?key=...` — Get presigned S3 view URL
- `POST /api/face/compare` — Compare delivery photo against reference via Rekognition
- `POST /api/face/save-reference` — Save reference photo key to farmer record

### Face Verification Logic
- Field officer takes live photo → uploaded to `invendimages` S3 bucket
- API calls `CompareFaces` against `farmers.photo_url` (stored S3 key)
- `faceStatus`: `Verified` (≥80% similarity), `Failed` (<80%), `NoFace`, `NoReference`, `Error`
- `NoReference`: photo saved, future deliveries will compare against it
- Officer can Override a failed match (flagged for supervisor review)

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
- `listIncidents(page, limit, status?)` → `{ data, total }` — paginated; rows include `officerName` joined from users
- `resolveIncident(id, resolutionNotes?)` → camelCase row — updates status to Resolved, logs audit

## Running the Application

All workflows start automatically:
- **API Server:** `artifacts/api-server: API Server` — Express on PORT
- **Web Portal:** `artifacts/web-portal: web` — Vite dev server on PORT
- **Field App:** `artifacts/field-app: expo` — Expo dev server on PORT 24635

## Database

PostgreSQL is provisioned via Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

**Push schema:** `pnpm --filter @workspace/db run push`
**Seed data:** `pnpm --filter @workspace/scripts run seed`

### Seed Credentials
**Web Portal (email login via Supabase):**
| Role              | Email                      | Password     |
|-------------------|----------------------------|--------------|
| Admin             | admin@agripo.sl            | admin123     |
| Project Manager   | john.kamara@agripo.sl      | password123  |
| Warehouse Manager | amara.sesay@agripo.sl      | password123  |
| Field Officer     | fatima.conteh@agripo.sl    | password123  |

**Mobile App (username login via API server JWT):**
| Role              | Username        | Password     |
|-------------------|-----------------|--------------|
| Admin             | admin           | admin123     |
| Field Officer     | fo.fatima       | password123  |

## Authentication

**Web portal:** Supabase Auth — `signInWithPassword({ email, password })`. Session maintained by Supabase client. `AuthProvider` in `use-auth.tsx` exposes `login`, `logout`, `user`, `isAuthenticated`.

**Mobile app:** API server JWT — `POST /api/auth/login` returns `{ token, user }`. Token stored in AsyncStorage `@auth`. Sent as `Authorization: Bearer <token>` on all requests.

Roles: `Admin`, `ProjectManager`, `DistrictCoordinator`, `WarehouseManager`, `FieldOfficer`, `Viewer`

## Modules / Pages

### Web Portal
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
| `/reports` | Beneficiary, stock movement, distribution, incidents reports |
| `/incidents` | Field incident registry with resolve action |
| `/audit` | Audit log viewer (paginated) |
| `/users` | User management (activate/deactivate) |
| `/settings` | Master data: districts, value chains, warehouses |

### Mobile Field App
| Screen | Description |
|--------|-------------|
| `/login` | Username + password login |
| `/(tabs)/` | Dashboard — stats, active dispatches, quick actions |
| `/(tabs)/distributions` | Dispatch list with search/filter |
| `/(tabs)/scan` | Camera scan + manual farmer lookup |
| `/(tabs)/incidents` | Field incident reports |
| `/(tabs)/sync` | Offline queue + sync management |
| `/distribution/[id]` | Dispatch detail + PoD records |
| `/scan-farmer` | Dedicated farmer barcode scan screen |
| `/confirm-pod` | GPS + quantity + submit PoD |
| `/incident/new` | New incident report form |

## Environment Variables / Secrets

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (used in web-portal)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (used in api-server)
- `SESSION_SECRET` — Session/JWT signing secret (api-server)
- `DATABASE_URL` — Direct PostgreSQL connection string (api-server + drizzle)
- `EASYSENDSMS_USERNAME` — EasySendSMS account username (OTP delivery)
- `EASYSENDSMS_PASSWORD` — EasySendSMS account password or API password
- `EASYSENDSMS_SENDER` — Sender name shown on SMS (max 11 alphanumeric, default `AgriPoD`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — IAM user `invendis-edge-system`
- `AWS_REGION` — `eu-west-2` (London)
- `AWS_S3_BUCKET` — `invendimages` (farmer reference + delivery photos)
- `EXPO_PUBLIC_DOMAIN` — Injected at runtime; mobile app uses this to reach the API

## AWS Infrastructure
- **S3 bucket:** `invendimages` (eu-west-2) — stores farmer photos at `farmers/{id}/reference/` and `farmers/{id}/delivery/`
- **Rekognition:** `CompareFaces` API — threshold 80% for match
- **IAM user:** `invendis-edge-system` — needs `AmazonS3FullAccess` + `AmazonRekognitionFullAccess`
- Photos are private; access via presigned URLs (5 min upload, 1 hr view)
- Metro config blocks `@aws-sdk`, `@aws-crypto`, `@smithy` from field-app bundle (server-only)
