# Agri-PoD Inventory & Distribution System
## Complete User Requirements, Workflows, Features, and Claude Code Build Instructions

**Target Country:** Sierra Leone  
**System Type:** Agriculture inventory, farmer beneficiary, distribution, Proof of Delivery, and vehicle tracking platform  
**Primary Users:** Agriculture project teams, warehouse teams, field officers, drivers, M&E officers, auditors, and project managers  
**Example Project Context:** Agriculture projects that provide free farming inputs to farmers, similar to AVDP-style operations  

---

# 1. System Vision

The system shall manage the full lifecycle of agricultural input distribution from procurement to final farmer delivery. It must prove that the right farming inputs were procured, received, stored, loaded, transported, delivered, verified, reconciled, and reported.

The system must provide strong Proof of Delivery using:

- Farmer barcode/QR code
- Input package barcode/QR code
- Vehicle manifest barcode/QR code
- OTP verification using Twilio
- GPS location of delivery point
- Facial biometric capture and verification
- Vehicle GPS tracking
- Offline mobile data capture
- Stock reconciliation
- Audit logs

The system must answer this operational question:

> Did the right farmer receive the right input package from the right vehicle, at the right location, by the right field officer, at the right time, with valid proof?

---

# 2. Recommended Technology Stack

## 2.1 Backend

- ASP.NET Core Web API
- Clean Architecture
- Entity Framework Core
- JWT authentication
- Role-based authorization
- FluentValidation
- Serilog logging
- OpenAPI/Swagger documentation
- Background worker services for sync and GPS processing

## 2.2 Web Portal

- Blazor Server or Blazor WebAssembly
- Responsive dashboard UI
- Role-based menu visibility
- Map view for GPS tracking
- Reporting and export features

## 2.3 Mobile App

- Flutter Android-first mobile app
- Offline-first design
- SQLite local storage
- Barcode/QR scanning
- GPS capture
- Camera/photo capture
- Facial biometric capture
- Sync queue

## 2.4 Databases

- Azure SQL Database for online central database
- SQL Server Express for district/offline node
- SQLite for Flutter mobile offline storage

## 2.5 External Services

- Twilio Verify for OTP
- Azure Blob Storage for photos, signatures, and evidence files
- Optional map service: Google Maps, Mapbox, or OpenStreetMap

---

# 3. Core Business Rules

1. A farmer must be registered and approved before receiving inputs.
2. A farmer must not receive more than the approved allocation.
3. A package must not be delivered more than once.
4. Inventory must not be marked as delivered without a valid PoD record.
5. A PoD record must include barcode scan, OTP, GPS, facial evidence, field officer identity, and timestamp.
6. Vehicle GPS must confirm that the assigned vehicle reached or was near the approved distribution site.
7. Offline PoD records must sync to the central server when internet becomes available.
8. Conflicts must be flagged for supervisor review.
9. All stock movement must be auditable.
10. All sensitive data must be protected.

---

# 4. User Roles

## 4.1 System Administrator

- Manage users
- Assign roles
- Configure system settings
- Manage master data
- Manage districts, chiefdoms, sections, and communities
- Manage value chains
- Review audit logs

## 4.2 Project Manager

- Create and approve distribution campaigns
- Review distribution performance
- Monitor stock and PoD progress
- Approve major exceptions
- Generate project reports

## 4.3 Procurement Officer

- Register purchased inputs
- Manage supplier records
- Submit stock for warehouse receiving
- View procurement and stock reports

## 4.4 Warehouse Manager

- Receive stock
- Generate package barcodes
- Manage stock balances
- Transfer stock
- Load vehicles
- Create dispatch manifests
- Reconcile returned stock

## 4.5 District Coordinator

- Approve farmer registrations
- Manage district campaigns
- Assign field officers
- Review district-level exceptions
- Monitor district stock and distribution progress

## 4.6 Field Officer

- Register farmers
- Conduct field verification
- Scan farmer barcode
- Send and verify OTP
- Capture facial evidence
- Capture GPS
- Scan input packages
- Submit PoD
- Work offline and sync later

## 4.7 Driver

- Accept vehicle dispatch
- Transport inputs
- Ensure GPS tracking is active
- Confirm arrival at distribution site
- Assist with returned stock reconciliation

## 4.8 Monitoring and Evaluation Officer

- Monitor farmer beneficiary data
- Review distribution reports
- Track gender, youth, district, and value chain indicators
- Export project reports

## 4.9 Auditor

- Review audit trails
- Investigate anomalies
- Review stock variance
- Review duplicate delivery attempts
- Review GPS and barcode scan evidence

---

# 5. Main System Modules and Features

## 5.1 User and Role Management

Features:

- User creation
- User editing
- User activation/deactivation
- Password reset
- Role assignment
- District-level access control
- Device binding for field officers
- Audit history per user

## 5.2 Master Data Management

Features:

- District setup
- Chiefdom setup
- Section setup
- Community setup
- Value chain setup
- Input category setup
- Unit of measure setup
- Warehouse setup
- Distribution site setup

## 5.3 Farmer Registry

Features:

- Farmer registration
- Farmer photo capture
- Farmer GPS capture
- Farmer value chain assignment
- Farmer group/cooperative assignment
- Farmer approval/rejection
- Farmer QR/barcode generation
- Farmer search and filtering
- Duplicate farmer detection
- Farmer profile history

Farmer data fields:

- Farmer code
- First name
- Last name
- Gender
- Date of birth or age group
- Phone number
- National ID or voter ID where available
- District
- Chiefdom
- Section
- Community
- Value chain
- Farm size
- Farm/community GPS latitude
- Farm/community GPS longitude
- Farmer group
- Photo
- Biometric template reference
- Eligibility status
- Barcode token

## 5.4 Input Catalogue

Features:

- Create input item
- Categorize by value chain
- Set unit of measure
- Track expiry-sensitive items
- Track supplier source
- Enable/disable input item

Input examples:

- Rice seed
- Vegetable seed
- Fertilizer
- Agrochemicals
- Cocoa seedlings
- Oil palm seedlings
- Farm tools
- PPE
- Irrigation kits

## 5.5 Procurement

Features:

- Register procurement order
- Record supplier
- Record purchased quantity
- Record funding source/donor
- Submit stock to warehouse
- View procurement history

## 5.6 Warehouse and Inventory Management

Features:

- Receive stock
- Inspect stock quality
- Record batch number
- Record expiry date
- Generate package barcodes
- Track available stock
- Reserve stock for campaign
- Transfer stock between warehouses
- Load stock onto vehicle
- Mark stock as returned, damaged, missing, or delivered
- View stock movement history

Stock statuses:

- Available
- Reserved
- LoadedOnVehicle
- Delivered
- Returned
- Damaged
- Missing
- Cancelled

## 5.7 Barcode/QR Code Management

The system must generate and manage QR/barcode tokens for:

- Farmer identity
- Input package identity
- Vehicle dispatch manifest
- Distribution session
- Warehouse stock transaction

Barcode rules:

- Do not encode sensitive personal data in the QR code.
- Use secure tokens.
- The app scans the token and retrieves data from local SQLite or backend API.
- Barcode scans must be logged.

Example tokens:

```text
FARMER:FRM-2026-000123
PACKAGE:PKG-2026-RICE-SEED-009812
MANIFEST:MNF-2026-KAM-000044
```

Preferred format:

```text
POD:TOKEN:8J29-KL4P-X9QM
```

## 5.8 Distribution Campaign Planning

Features:

- Create campaign
- Select season
- Select district/chiefdom/community
- Select value chain
- Define distribution date
- Define distribution site
- Set GPS geofence radius
- Select eligible farmers
- Assign input package
- Assign warehouse stock
- Assign vehicle
- Assign driver
- Assign field officers
- Submit for approval
- Approve campaign
- Sync campaign data to mobile devices

Campaign statuses:

- Draft
- Submitted
- Approved
- Active
- Completed
- Cancelled

## 5.9 Farmer Allocation

Features:

- Allocate input packages to farmers
- Bulk allocate by value chain, district, community, or farmer group
- Validate eligibility
- Prevent duplicate allocation
- Export allocation list
- Sync allocation to mobile app

## 5.10 Vehicle and Driver Management

Features:

- Register vehicle
- Register driver
- Assign driver to vehicle
- Register GPS tracker/device
- View vehicle status
- View last known location
- Track route history

Vehicle fields:

- Vehicle code
- Plate number
- Vehicle type
- Capacity
- Driver
- GPS device ID
- Tracker IMEI
- Status

## 5.11 Vehicle Dispatch Manifest

Features:

- Create dispatch record
- Select campaign
- Select warehouse
- Select vehicle
- Select driver
- Generate manifest barcode
- Scan packages into vehicle
- Validate loaded packages
- Start dispatch
- Track route
- Confirm arrival
- Close dispatch

Dispatch statuses:

- Draft
- Approved
- Loading
- Dispatched
- Arrived
- Completed
- Reconciled
- Cancelled

## 5.12 Vehicle GPS Tracking

Features:

- GPS ping endpoint
- Bulk GPS upload
- Live vehicle map
- Route tracking
- Stop detection
- Route deviation detection
- Arrival confirmation
- Vehicle proximity validation for PoD
- GPS history report

GPS ping fields:

- Vehicle ID
- Dispatch ID
- Device ID
- Latitude
- Longitude
- Speed
- Heading
- Battery level
- Network status
- Recorded timestamp

## 5.13 Distribution Session

Features:

- Start distribution session on mobile
- Scan vehicle manifest
- Validate assigned campaign
- Validate vehicle GPS arrival
- Validate field officer assignment
- Validate distribution site GPS
- Open farmer delivery queue
- End session
- Submit session summary

## 5.14 Proof of Delivery

PoD must include:

- Farmer barcode scan
- Input package barcode scan
- Vehicle manifest barcode scan
- OTP verification
- Facial biometric capture
- Delivery GPS location
- Vehicle GPS proximity validation
- Field officer ID
- Timestamp
- Quantity delivered
- Photo evidence if required
- Farmer signature or thumbprint if required

PoD statuses:

- Pending
- Verified
- PendingSync
- Rejected
- OtpFailed
- FaceMismatch
- BarcodeInvalid
- InputNotAssigned
- VehicleNotAtSite
- GpsOutsideArea
- DuplicateSuspected
- PackageAlreadyDelivered
- SupervisorReviewRequired

## 5.15 OTP Verification

Features:

- Send OTP using Twilio from backend only
- Verify OTP
- Rate-limit OTP requests
- Log OTP status
- Support resend rules
- Mask phone numbers in UI
- Allow supervisor override only where policy allows

## 5.16 Facial Biometric Verification

Features:

- Capture live face image
- Compare against farmer profile photo/template
- Store verification result
- Support manual review for low-confidence matches
- Optional liveness detection

MVP rule:

- Capture face image and mark as pending/manual review if automated face matching is not yet implemented.

## 5.17 GPS Verification

Features:

- Capture GPS during registration
- Capture GPS during PoD
- Validate distribution site geofence
- Validate vehicle GPS proximity
- Store GPS accuracy value
- Flag GPS outside allowed radius

## 5.18 Offline Mobile Operation

Features:

- Offline login with cached session
- Download assigned campaigns
- Store farmer allocation locally
- Store package list locally
- Store PoD records locally
- Prevent duplicate delivery locally
- Queue records for sync
- Retry failed sync
- Flag sync conflicts
- Encrypt sensitive local data

## 5.19 Data Synchronization

Features:

- Bootstrap sync for mobile app
- Pull assigned campaigns
- Push offline PoD records
- Push GPS records
- Push barcode scan logs
- Conflict detection
- Conflict resolution
- Sync status dashboard

Sync rules:

- Every offline record must have OfflineTransactionId.
- Every device must have DeviceId.
- Every sync batch must have SyncBatchId.
- Server is final authority.
- Failed records remain in queue.

## 5.20 Stock Reconciliation

Features:

- Compare loaded, delivered, returned, damaged, and missing stock
- Scan returned packages
- Submit reconciliation report
- Supervisor approval
- Generate variance report

## 5.21 Exception Handling

Exception examples:

- Farmer not found
- Farmer not allocated
- OTP failed
- Face mismatch
- GPS outside area
- Vehicle not at site
- Package already delivered
- Package not loaded on vehicle
- Duplicate farmer delivery
- Missing package
- Damaged package

Features:

- Capture exception reason
- Capture photo evidence
- Submit for review
- Approve/reject exception
- Audit decision

## 5.22 Reporting and Dashboards

Reports:

- Farmer beneficiary report
- Gender report
- Youth report
- District report
- Chiefdom report
- Community report
- Value chain report
- Stock balance report
- Stock movement report
- Vehicle dispatch report
- Vehicle GPS report
- PoD verification report
- OTP failure report
- Face mismatch report
- GPS exception report
- Duplicate delivery report
- Barcode scan history
- Stock reconciliation report
- Audit report

Report features:

- Filter by date range
- Filter by district
- Filter by campaign
- Filter by value chain
- Export to PDF
- Export to Excel
- Print report

## 5.23 Audit Logging

Audit all critical actions:

- Login
- Failed login
- Farmer creation/edit/approval
- Stock receiving
- Stock transfer
- Package loading
- Dispatch approval
- PoD submission
- OTP verification
- Exception approval
- Stock reconciliation
- User role changes

---

# 6. Complete Workflows

## 6.1 User Authentication Workflow

1. User opens web portal or mobile app.
2. User enters username and password.
3. System validates credentials.
4. System checks user status.
5. System checks assigned role.
6. System issues JWT access token and refresh token.
7. System loads role-specific menu.
8. User accesses allowed features only.

## 6.2 Farmer Registration Workflow

1. Field officer opens mobile app.
2. Field officer selects farmer registration.
3. Field officer enters farmer personal details.
4. Field officer selects district, chiefdom, section, and community.
5. Field officer selects value chain.
6. Field officer captures farm/community GPS location.
7. Field officer captures farmer photo.
8. Field officer captures biometric face image if required.
9. System validates required fields.
10. System generates farmer code and barcode token.
11. Record is saved locally if offline.
12. Record syncs to server when online.
13. District Coordinator reviews registration.
14. District Coordinator approves or rejects farmer.
15. Approved farmer becomes eligible for allocation.

## 6.3 Input Procurement Workflow

1. Procurement Officer creates procurement record.
2. Procurement Officer selects supplier.
3. Procurement Officer records input items, quantities, batch information, and funding source.
4. Procurement Officer submits procurement record to warehouse.
5. Warehouse Manager receives notification for stock receiving.

## 6.4 Stock Receiving Workflow

1. Warehouse Manager opens pending procurement receipt.
2. Warehouse Manager verifies delivered quantity.
3. Warehouse Manager checks quality and expiry date.
4. Warehouse Manager records accepted quantity.
5. Warehouse Manager records rejected/damaged quantity if any.
6. System creates input batch record.
7. System creates package units.
8. System generates package barcodes.
9. Stock status becomes Available.
10. Audit log is recorded.

## 6.5 Barcode Generation Workflow

1. User selects item requiring barcode.
2. System generates secure barcode token.
3. System links token to farmer, package, or manifest.
4. System renders printable QR/barcode label.
5. User prints or saves barcode.
6. All future scans are logged.

## 6.6 Campaign Planning Workflow

1. Project Manager creates campaign.
2. Project Manager selects season and value chain.
3. Project Manager selects district, chiefdom, and community.
4. Project Manager defines distribution site and GPS radius.
5. Project Manager selects eligible farmers.
6. Project Manager assigns input package type.
7. Project Manager reserves warehouse stock.
8. Project Manager assigns vehicle and driver.
9. Project Manager assigns field officers.
10. Project Manager submits campaign for approval.
11. Authorized user approves campaign.
12. Campaign is synced to mobile devices.

## 6.7 Farmer Allocation Workflow

1. User opens approved campaign.
2. User filters eligible farmers.
3. User selects farmers for allocation.
4. User assigns input package and quantity.
5. System checks farmer eligibility.
6. System checks available stock.
7. System prevents duplicate allocation.
8. Allocation is saved.
9. Allocation is included in mobile sync package.

## 6.8 Vehicle Dispatch Workflow

1. Warehouse Manager opens approved campaign.
2. Warehouse Manager creates vehicle dispatch.
3. Warehouse Manager selects vehicle and driver.
4. System generates vehicle manifest barcode.
5. Warehouse team scans each package into the vehicle.
6. System validates package belongs to campaign.
7. System changes package status to LoadedOnVehicle.
8. Driver confirms loaded stock.
9. Dispatch status becomes Dispatched.
10. Vehicle GPS tracking starts.

## 6.9 Vehicle GPS Tracking Workflow

1. Vehicle GPS tracker or driver mobile app sends GPS pings.
2. Backend records GPS point.
3. System links GPS point to active dispatch.
4. System displays vehicle on live map.
5. System detects stops and route deviation.
6. System confirms arrival when vehicle enters distribution site geofence.
7. Vehicle GPS evidence becomes available for PoD validation.

## 6.10 Distribution Session Workflow

1. Field Officer reaches distribution site.
2. Field Officer opens assigned campaign on mobile app.
3. Field Officer scans vehicle manifest barcode.
4. App validates manifest against campaign.
5. App captures current GPS location.
6. App validates that location is within distribution site radius.
7. App validates vehicle GPS proximity.
8. Distribution session starts.
9. Farmer PoD process can begin.

## 6.11 Proof of Delivery Workflow

1. Field Officer scans farmer QR/barcode.
2. App loads farmer profile and allocation.
3. App checks that farmer is approved and allocated.
4. Field Officer scans input package QR/barcode.
5. App verifies package is assigned to campaign and loaded on the vehicle.
6. App sends OTP to farmer phone through backend/Twilio.
7. Farmer provides OTP.
8. App verifies OTP.
9. Field Officer captures farmer face image.
10. System verifies face or marks for manual review.
11. App captures GPS location.
12. App validates delivery location against distribution site.
13. App validates vehicle GPS proximity.
14. Field Officer confirms quantity delivered.
15. Farmer signs or thumbprint is captured if required.
16. App saves PoD record locally.
17. If online, app syncs to server.
18. Server validates PoD.
19. Package status becomes Delivered.
20. Farmer allocation status becomes Delivered.
21. Audit log is recorded.

## 6.12 Offline PoD Workflow

1. Mobile app detects poor or no internet.
2. App switches to offline mode.
3. Field Officer continues scanning barcodes and recording PoD.
4. App uses locally synced campaign, farmer, and package data.
5. App prevents local duplicate delivery.
6. App assigns OfflineTransactionId to every record.
7. App queues records for sync.
8. When internet returns, app syncs records to backend.
9. Backend validates and stores records.
10. Conflicts are flagged for supervisor review.

## 6.13 Sync Workflow

1. App checks connectivity.
2. App authenticates with backend.
3. App sends pending sync batch.
4. Backend validates batch signature, user, and device.
5. Backend processes PoD records, scan logs, GPS logs, and evidence files.
6. Valid records are accepted.
7. Invalid records are rejected with reasons.
8. Conflicting records are flagged.
9. App updates local sync status.
10. User sees successful, failed, and conflict records.

## 6.14 Stock Reconciliation Workflow

1. Distribution session ends.
2. Field Officer or Warehouse Manager scans returned packages.
3. System compares loaded packages with delivered packages.
4. System calculates returned, missing, damaged, and delivered quantities.
5. User submits reconciliation.
6. Supervisor reviews variance.
7. Supervisor approves or rejects reconciliation.
8. Final stock balances are updated.
9. Reconciliation report is generated.

## 6.15 Exception Handling Workflow

1. System detects exception.
2. App or web portal displays exception reason.
3. User captures additional evidence if required.
4. Exception is submitted for supervisor review.
5. Supervisor reviews evidence.
6. Supervisor approves, rejects, or requests correction.
7. System records final decision.
8. Audit log is updated.

## 6.16 Reporting Workflow

1. User opens reports module.
2. User selects report type.
3. User applies filters.
4. System generates report.
5. User views charts and tables.
6. User exports to PDF or Excel.
7. System logs report generation where required.

## 6.17 Audit Workflow

1. Auditor opens audit log.
2. Auditor filters by user, date, module, campaign, or district.
3. Auditor reviews critical actions.
4. Auditor investigates suspicious records.
5. Auditor exports audit report.
6. Audit finding is recorded if required.

---

# 7. Web Portal User Interface Requirements

## 7.1 Main Navigation

The Blazor web portal must include:

- Dashboard
- Farmers
- Inventory
- Warehouses
- Procurement
- Campaigns
- Allocations
- Vehicles
- Dispatch
- GPS Tracking
- Proof of Delivery
- Reconciliation
- Reports
- Users and Roles
- Audit Logs
- Settings

## 7.2 Dashboard

Dashboard cards:

- Total farmers
- Approved farmers
- Total stock
- Distributed inputs
- Pending PoD
- Exceptions
- Active vehicles
- Stock variance

Dashboard charts:

- Distribution by district
- Distribution by value chain
- Gender distribution
- Youth beneficiary count
- Stock movement trend

Map:

- Live vehicle locations
- Distribution sites
- Warehouse locations

## 7.3 Farmer Registry UI

Farmer list columns:

- Farmer code
- Name
- Gender
- Phone
- District
- Chiefdom
- Community
- Value chain
- Status
- Barcode
- Actions

Actions:

- View
- Edit
- Approve
- Reject
- Print barcode

## 7.4 Inventory UI

Input catalogue columns:

- Input code
- Input name
- Category
- Value chain
- Unit
- Description
- Status
- Actions

Stock balance columns:

- Warehouse
- Input item
- Batch number
- Available quantity
- Reserved quantity
- Loaded quantity
- Delivered quantity
- Returned quantity
- Damaged quantity

## 7.5 Campaign UI

Campaign list columns:

- Campaign code
- Campaign name
- Season
- District
- Value chain
- Start date
- End date
- Status
- Actions

Actions:

- View
- Edit
- Approve
- Assign farmers
- Assign stock
- Assign vehicles

## 7.6 Vehicle Tracking UI

The GPS tracking page must show:

- Live map
- Vehicle markers
- Route lines
- Stop points
- Route deviation alerts
- Vehicle status panel

Vehicle status panel fields:

- Vehicle
- Driver
- Speed
- Last ping
- Current location
- Assigned campaign
- Route status
- Battery
- Network status

## 7.7 PoD Monitoring UI

PoD table columns:

- PoD code
- Farmer
- Package
- Campaign
- Field officer
- Vehicle
- OTP status
- Face status
- GPS status
- Vehicle GPS status
- PoD status
- Timestamp
- Actions

Actions:

- View evidence
- Approve exception
- Reject exception
- Export report

---

# 8. Flutter Mobile App UI Requirements

## 8.1 Bottom Navigation

- Home
- Campaigns
- Scan
- Sync
- Profile

## 8.2 Mobile Screens

The Flutter app must include:

- Login screen
- Offline data sync screen
- Home dashboard
- Assigned campaigns list
- Campaign details
- Start distribution session
- Scan vehicle manifest
- Validate vehicle GPS
- Scan farmer barcode
- Farmer profile
- Send OTP
- Verify OTP
- Capture face
- Scan input package
- Capture GPS
- PoD confirmation
- Save offline
- Pending sync queue
- Stock return scan
- End-of-day reconciliation
- Exception report

## 8.3 Mobile Home Screen

Cards:

- Assigned campaigns
- Pending PoD sync
- Today’s deliveries
- Exceptions
- GPS status
- Offline mode status

## 8.4 PoD Confirmation Screen

Show checklist:

- Farmer barcode: Passed/Failed
- Input barcode: Passed/Failed
- Manifest barcode: Passed/Failed
- OTP: Passed/Failed
- Face capture: Passed/Failed
- GPS: Passed/Failed
- Vehicle GPS: Passed/Failed
- Duplicate check: Passed/Failed

Actions:

- Confirm delivery
- Save offline
- Cancel
- Submit exception

---

# 9. Database Entity Requirements

Implement these core entities:

- User
- Role
- District
- Chiefdom
- Section
- Community
- ValueChain
- Farmer
- FarmerBiometric
- InputItem
- InputBatch
- InputPackage
- Supplier
- ProcurementOrder
- Warehouse
- StockTransaction
- DistributionCampaign
- DistributionPlan
- FarmerAllocation
- Vehicle
- Driver
- VehicleDevice
- VehicleDispatch
- VehicleDispatchItem
- VehicleManifest
- VehicleGpsTrack
- VehicleGpsPoint
- DistributionSession
- ProofOfDelivery
- ProofOfDeliveryItem
- OtpVerificationLog
- Barcode
- BarcodeScanLog
- GpsLog
- StockReconciliation
- StockReconciliationItem
- SyncLog
- SyncBatch
- AuditLog
- ExceptionReport

---

# 10. API Endpoint Requirements

## 10.1 Authentication

```http
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

## 10.2 Farmers

```http
GET    /api/farmers
GET    /api/farmers/{id}
POST   /api/farmers
PUT    /api/farmers/{id}
POST   /api/farmers/{id}/photo
POST   /api/farmers/{id}/biometric
GET    /api/farmers/barcode/{token}
POST   /api/farmers/{id}/approve
POST   /api/farmers/{id}/reject
```

## 10.3 Inventory

```http
GET    /api/input-items
POST   /api/input-items
GET    /api/input-batches
POST   /api/input-batches
POST   /api/warehouses/{id}/receive-stock
POST   /api/warehouses/{id}/transfer-stock
GET    /api/warehouses/{id}/stock-balance
GET    /api/input-packages/barcode/{token}
```

## 10.4 Campaigns

```http
GET    /api/campaigns
POST   /api/campaigns
PUT    /api/campaigns/{id}
POST   /api/campaigns/{id}/approve
POST   /api/campaigns/{id}/allocate-farmers
GET    /api/campaigns/{id}/mobile-sync-package
```

## 10.5 Vehicle Dispatch

```http
POST   /api/vehicle-dispatches
POST   /api/vehicle-dispatches/{id}/approve
POST   /api/vehicle-dispatches/{id}/scan-package
POST   /api/vehicle-dispatches/{id}/dispatch
POST   /api/vehicle-dispatches/{id}/arrive
GET    /api/vehicle-dispatches/manifest/{token}
GET    /api/vehicle-dispatches/{id}/items
```

## 10.6 Vehicle GPS

```http
POST   /api/vehicle-gps/ping
POST   /api/vehicle-gps/bulk
GET    /api/vehicle-gps/vehicle/{vehicleId}/latest
GET    /api/vehicle-gps/dispatch/{dispatchId}/track
```

## 10.7 OTP

```http
POST   /api/otp/send
POST   /api/otp/verify
```

## 10.8 Proof of Delivery

```http
POST   /api/pod/start-session
POST   /api/pod/verify-farmer-barcode
POST   /api/pod/verify-input-barcode
POST   /api/pod/verify-manifest
POST   /api/pod/submit
POST   /api/pod/offline-sync
GET    /api/pod/{id}
GET    /api/pod/campaign/{campaignId}
```

## 10.9 Sync

```http
GET    /api/sync/bootstrap
POST   /api/sync/push
GET    /api/sync/pull
POST   /api/sync/resolve-conflict
```

---

# 11. Security Requirements

The system must implement:

- JWT authentication
- Refresh tokens
- Role-based access control
- Password hashing
- Device registration
- OTP rate limiting
- HTTPS only
- Input validation
- File upload validation
- Audit logs
- Sensitive data masking
- Encrypted secrets
- Offline data encryption
- Biometric data protection
- Least privilege access

Twilio credentials must never be stored in source code. Use environment variables or secure configuration.

---

# 12. Non-Functional Requirements

## 12.1 Performance

- Must support thousands of farmers per campaign.
- Must support multiple districts.
- Must support offline mobile field operations.

## 12.2 Reliability

- Offline records must not be lost.
- Sync must retry failed records.
- Server validation must prevent duplicate delivery.

## 12.3 Usability

- Mobile app must use large buttons.
- Field workflows must be scan-first.
- App must clearly show online/offline status.
- Error messages must be simple and actionable.

## 12.4 Scalability

- Architecture must support expansion beyond Sierra Leone.
- Master data must allow adding districts, countries, value chains, and projects.

## 12.5 Auditability

- Every stock movement and PoD action must be traceable.
- Every exception must include reason, evidence, and reviewer decision.

---

# 13. Claude Code Build Instructions

Copy the following section into Claude Code as the main build instruction.

---

## Claude Code Prompt

You are a senior full-stack software engineer. Build a production-grade Agri-PoD Inventory and Distribution System for agriculture projects in Sierra Leone.

The system must include:

1. ASP.NET Core Web API backend
2. Blazor web portal
3. Flutter Android mobile app
4. Azure SQL online database support
5. SQL Server Express offline/district node support
6. SQLite mobile offline storage
7. Twilio OTP verification
8. Barcode/QR scanning
9. GPS capture
10. Vehicle GPS tracking
11. Facial biometric capture
12. Offline sync
13. Stock reconciliation
14. Audit logs and reports

Create a monorepo with this structure:

```text
agri-pod-system/
  backend/
    AgriPod.Api/
    AgriPod.Application/
    AgriPod.Domain/
    AgriPod.Infrastructure/
    AgriPod.Shared/
    AgriPod.Tests/
  web/
    AgriPod.Blazor/
  mobile/
    agri_pod_mobile/
  database/
    migrations/
    seed-data/
    sql-express-sync/
  docs/
    api-spec/
    architecture/
    deployment/
```

Use Clean Architecture for the backend:

- Domain: entities, enums, business rules
- Application: DTOs, validators, service interfaces, use cases
- Infrastructure: EF Core, repositories, external services, Twilio, file storage
- API: controllers, auth, middleware, Swagger
- Tests: unit and integration tests

Build the backend first with:

- Authentication and roles
- Farmer registry APIs
- Inventory APIs
- Campaign APIs
- Barcode APIs
- Vehicle dispatch APIs
- Vehicle GPS APIs
- PoD APIs
- Sync APIs
- Report APIs

Implement the Blazor web portal with pages for:

- Dashboard
- Farmer registry
- Inventory
- Warehouse stock
- Procurement
- Campaign planning
- Farmer allocation
- Vehicle registry
- Dispatch manifest
- Live GPS tracking
- Proof of Delivery monitoring
- Stock reconciliation
- Reports
- Users and roles
- Audit logs
- Settings

Implement the Flutter mobile app with screens for:

- Login
- Home dashboard
- Assigned campaigns
- Campaign details
- Start distribution session
- Scan vehicle manifest
- Scan farmer barcode
- Farmer profile
- OTP send and verify
- Face capture
- Scan input package
- GPS capture
- PoD confirmation
- Offline sync queue
- Exception report
- Stock return scan
- End-of-day reconciliation

The Proof of Delivery flow must validate:

- Farmer barcode
- Input package barcode
- Vehicle manifest barcode
- Farmer allocation
- OTP verification
- Facial capture/verification
- Delivery GPS
- Vehicle GPS proximity
- Package not previously delivered
- Farmer not previously served for same campaign
- Field officer assigned to campaign

Use these package/status enums:

```text
InputPackageStatus:
Available
Reserved
LoadedOnVehicle
Delivered
Returned
Damaged
Missing
Cancelled

CampaignStatus:
Draft
Submitted
Approved
Active
Completed
Cancelled

VehicleDispatchStatus:
Draft
Approved
Loading
Dispatched
Arrived
Completed
Reconciled
Cancelled

ProofOfDeliveryStatus:
Pending
Verified
PendingSync
Rejected
OtpFailed
FaceMismatch
BarcodeInvalid
InputNotAssigned
VehicleNotAtSite
GpsOutsideArea
DuplicateSuspected
PackageAlreadyDelivered
SupervisorReviewRequired
```

Build the MVP in this order:

1. Create repo structure
2. Create ASP.NET Core solution
3. Add domain entities and enums
4. Add EF Core DbContext
5. Add migrations and seed data
6. Add authentication and authorization
7. Add farmer APIs
8. Add inventory APIs
9. Add campaign APIs
10. Add barcode generation and validation
11. Add vehicle dispatch APIs
12. Add vehicle GPS ping APIs
13. Add PoD validation APIs
14. Add offline sync APIs
15. Create Blazor portal UI
16. Create Flutter app UI
17. Add SQLite offline storage
18. Add QR scanning
19. Add GPS capture
20. Add Twilio OTP backend integration
21. Add reporting
22. Add audit logs
23. Add tests
24. Add README and deployment guide

For the MVP, facial recognition may be stubbed as:

```text
FaceCaptured = true
FaceVerified = PendingManualReview
```

But design the code so that a real face verification provider can be added later.

Do not expose Twilio secrets in Flutter. All OTP sending and verification must go through the ASP.NET Core backend.

All offline records must include:

- OfflineTransactionId
- DeviceId
- CreatedAt
- SyncStatus
- SyncBatchId when synced

Every critical action must write to AuditLog.

Generate clean, maintainable, production-ready code with comments, validation, error handling, and tests.

Also generate documentation:

- README.md
- API documentation
- Database setup guide
- Mobile app setup guide
- Deployment guide
- Environment variable sample file

---

# 14. MVP Scope

The first working version must include:

- Login and role-based access
- Farmer registration and approval
- Input catalogue
- Warehouse stock receiving
- Package barcode generation
- Campaign setup
- Farmer allocation
- Vehicle registry
- Vehicle dispatch manifest
- Package loading scan
- Vehicle GPS ping endpoint
- Mobile assigned campaign sync
- Mobile manifest scan
- Mobile farmer scan
- Mobile package scan
- Mobile GPS capture
- Twilio OTP
- PoD submission
- Offline sync queue
- Basic dashboard
- Basic reports
- Audit logs

---

# 15. Final Acceptance Criteria

The system is acceptable when:

1. Users can log in with role-based access.
2. Farmers can be registered, approved, and assigned barcodes.
3. Inputs can be received into warehouse stock.
4. Input packages can be generated with barcodes.
5. Campaigns can be created and approved.
6. Farmers can be allocated to campaigns.
7. Vehicles can be assigned and loaded with scanned packages.
8. Vehicle GPS pings can be recorded and displayed.
9. Field officers can conduct PoD on mobile.
10. PoD captures barcode, OTP, GPS, face, vehicle, package, farmer, and timestamp evidence.
11. Offline PoD records sync successfully.
12. Duplicate delivery is prevented.
13. Stock reconciliation identifies delivered, returned, damaged, and missing stock.
14. Reports can be generated and exported.
15. Audit logs record all critical actions.

---

# 16. End-to-End Summary

```text
Farmer Registration
   ↓
Farmer Approval
   ↓
Input Procurement
   ↓
Stock Receiving
   ↓
Package Barcode Generation
   ↓
Campaign Planning
   ↓
Farmer Allocation
   ↓
Vehicle Dispatch
   ↓
Package Loading Scan
   ↓
Vehicle GPS Tracking
   ↓
Distribution Session
   ↓
Proof of Delivery
   ↓
Offline Sync
   ↓
Stock Reconciliation
   ↓
Reporting and Audit
```

---

# 17. Closing Requirement

The system must be designed for real field operations in Sierra Leone, where internet connectivity may be poor. Therefore, the mobile application must be offline-first, simple to use, scan-first, GPS-aware, and secure.

