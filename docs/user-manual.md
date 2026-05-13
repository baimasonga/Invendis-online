# Invendis — Scenario-Based User Manual

**System:** Invendis Inventory & Distribution System  
**Coverage:** Web Portal (Admin/Manager) + Field App (Field Officer)  
**Test Credentials:**

| Account | Email | Password | Role |
|---------|-------|----------|------|
| Admin | mohamedbangura@avdp.org.sl | Invendis@2024 | Admin |
| Field Officer | mohamedamadubangura@gmail.com | Invendis@2024 | FieldOfficer |

---

## How to Use This Manual

Each scenario is self-contained and builds on realistic field operations in Sierra Leone. Work through them in order for a complete end-to-end test, or jump to any section to test a specific feature. Every step has an expected outcome so you know if it worked.

---

## PART A — WEB PORTAL

---

### Scenario 1 — Admin Logs In and Checks the Dashboard

**Who:** Admin  
**URL:** Open the web portal preview (main app, path `/`)

**Steps:**
1. Navigate to `/login`
2. Enter email `mohamedbangura@avdp.org.sl` and password `Invendis@2024`
3. Click **Sign In**

**Expected:** You land on the Dashboard (`/dashboard`) showing summary cards — total farmers, active campaigns, dispatches in transit, and PoDs today.

4. Check the charts — Farmer Registration Trend and Distribution Progress should display bars/lines.
5. Note the "Dispatches In Transit" card number — you will verify this later in GPS Tracking.

---

### Scenario 2 — Add a New District and Warehouse (Settings)

**Who:** Admin  
**URL:** `/settings`

This sets up master data that everything else depends on.

**Steps:**
1. Navigate to **Settings** in the sidebar
2. Under **Districts**, click **Add District** → enter name `Test District`, choose a region → Save
   - **Expected:** New district appears in the list
3. Under **Warehouses**, click **Add Warehouse** → enter:
   - Name: `Test Warehouse`
   - District: `Test District`
   - Capacity: `5000`
   → Save
   - **Expected:** Warehouse appears in the list with status Active

---

### Scenario 3 — Register a New Farmer

**Who:** Admin or Project Manager  
**URL:** `/farmers`

**Steps:**
1. Navigate to **Farmers** in the sidebar
2. Click **Add Farmer** (or **Register Farmer** button)
3. Fill in the form:
   - First Name: `Fatmata`
   - Last Name: `Koroma`
   - Phone: `+23276001234`
   - Gender: Female
   - District: pick any existing district
   - Village / Community: `Makeni Central`
   - Value Chain: pick any (e.g. Rice)
4. Click **Save / Register**

**Expected:** Farmer is created with status `Pending`. You are taken to the farmer detail page.

5. On the farmer detail page, locate the **QR Code** — this is the farmer's unique barcode token used in the field app for scanning.
6. Click **Approve** to approve the farmer.

**Expected:** Status changes to `Approved`. The farmer can now receive distributions.

7. Use the **Search** bar on `/farmers` to search by `Koroma` — the farmer you just created should appear.

---

### Scenario 4 — Receive Stock into a Warehouse

**Who:** Admin or Warehouse Manager  
**URL:** `/inventory`

**Steps:**
1. Navigate to **Inventory** in the sidebar
2. Click **Receive Stock**
3. Fill in:
   - Warehouse: `Test Warehouse` (created in Scenario 2)
   - Input Item: pick any item (e.g. Improved Rice Seed)
   - Quantity: `500`
   - Reference: `PO-TEST-001`
4. Click **Confirm Receipt**

**Expected:** Stock balance for that item in Test Warehouse shows `500` units available.

5. Scroll to the **Stock Balance** table — verify the new balance row appears.

---

### Scenario 5 — Create a Distribution Campaign

**Who:** Admin or Project Manager  
**URL:** `/campaigns`

**Steps:**
1. Navigate to **Campaigns** in the sidebar
2. Click **New Campaign**
3. Fill in:
   - Name: `2025 Test Season — Test District`
   - Season: Raining 2025
   - District: `Test District`
   - Warehouse: `Test Warehouse`
   - Start Date: today
   - End Date: 30 days from today
4. Click **Save**

**Expected:** Campaign created with status `Draft`. You see it in the campaigns list.

5. Click the campaign to open its detail page.
6. Click **Activate Campaign** (or **Start**).

**Expected:** Status changes to `Active`.

7. Under **Allocations** on the campaign detail, click **Add Allocation** → select farmer `Fatmata Koroma` → set quantity `50 kg` → Save.

**Expected:** Fatmata Koroma appears in the allocation list for this campaign.

---

### Scenario 6 — Create and Dispatch a Manifest

**Who:** Admin or Warehouse Manager  
**URL:** `/dispatch`

**Steps:**
1. Navigate to **Dispatch** in the sidebar
2. Click **New Dispatch**
3. Fill in:
   - Campaign: `2025 Test Season — Test District`
   - Warehouse: `Test Warehouse`
   - Vehicle: pick any vehicle (or enter hired plate if no vehicle is registered)
   - Driver: pick any driver
4. Click **Create Manifest**

**Expected:** Manifest created with a code like `MAN-XXXXXX`, status `Draft`.

5. Open the manifest detail — click **Add Item**:
   - Input Item: Improved Rice Seed
   - Quantity Loaded: `50`
   → Save
6. Click **Approve Manifest**

**Expected:** Status changes to `Approved`.

7. Click **Start Dispatch** (or **Dispatch**)

**Expected:** Status changes to `In Transit`. The vehicle status updates to InTransit.

---

### Scenario 7 — Monitor Live GPS Tracking

**Who:** Admin or Project Manager  
**URL:** `/gps-tracking`

**Steps:**
1. Navigate to **GPS Tracking** in the sidebar
2. The map loads showing vehicles currently In Transit

**Expected:** Any vehicle marked InTransit from Scenario 6 appears as a pin on the map.

3. Click a vehicle pin — a tooltip should show:
   - Manifest code
   - Driver name
   - Distance to destination
   - Last ping time
4. The page auto-refreshes every 30 seconds — watch the "Last Ping" timestamp update if a GPS ping is received.

> **To simulate a GPS ping (optional):**  
> Open a terminal and run:
> ```
> curl -s -X POST http://localhost:80/api/gps/ping \
>   -H "Content-Type: application/json" \
>   -H "Authorization: Bearer <token>" \
>   -d '{"vehicleId":2,"dispatchId":4,"latitude":8.484,"longitude":-13.234,"speed":45}'
> ```

---

### Scenario 8 — View Proof of Delivery Records

**Who:** Admin or Project Manager  
**URL:** `/pod`

**Steps:**
1. Navigate to **PoD** in the sidebar
2. The table lists all submitted Proof of Delivery records
3. Check columns: Farmer Name, Manifest Code, Quantity, GPS Coordinates, OTP Status, Face Status, Date

**Expected:** Any PoDs submitted via the field app appear here.

4. Use the filter dropdowns to filter by Status (`Verified`, `Pending`, `Overridden`) or by Campaign.
5. Click a PoD row to view the full detail — GPS map pin, face photo, OTP channel used.

---

### Scenario 9 — Reconcile Stock

**Who:** Warehouse Manager or Admin  
**URL:** `/reconciliation`

**Steps:**
1. Navigate to **Reconciliation** in the sidebar
2. Click **New Reconciliation**
3. Select:
   - Warehouse: `Test Warehouse`
   - Manifest: the one created in Scenario 6
4. Enter quantities returned and quantities delivered as reported by the driver
5. Click **Submit Reconciliation**

**Expected:** A reconciliation record is created. Stock balance in Test Warehouse is adjusted by the returned quantity.

---

### Scenario 10 — Review Field Incidents

**Who:** Admin or District Coordinator  
**URL:** `/incidents`

**Steps:**
1. Navigate to **Incidents** in the sidebar
2. Any incidents submitted via the field app appear here with columns: Code, Type, Status, Reported By, Date

**Expected:** Incidents show with status `Open`.

3. Click an incident row → click **Resolve**
4. Enter resolution notes: `Issue reviewed and addressed by district coordinator`
5. Click **Confirm**

**Expected:** Incident status changes to `Resolved`. Resolution notes and timestamp are saved.

---

### Scenario 11 — Run Reports

**Who:** Admin or Project Manager  
**URL:** `/reports`

**Steps:**
1. Navigate to **Reports** in the sidebar
2. Test each report tab:

**Beneficiary Report:**
- Shows farmers by district with totals, approved counts, female percentages
- Expected: Table with district rows and a summary row at the bottom

**Stock Movement Report:**
- Shows all stock transactions (RECEIVE, TRANSFER, ISSUE)
- Expected: Rows with date, item name, warehouse, quantity, transaction type

**Distribution Report:**
- Shows each manifest with campaign name, warehouse, status, and % completion
- Expected: The manifest from Scenario 6 appears with its completion percentage

**Incidents Report:**
- Filterable list of all incidents
- Expected: Shows open and resolved incidents with officer names

---

### Scenario 12 — Manage Users

**Who:** Admin  
**URL:** `/users`

**Steps:**
1. Navigate to **Users** in the sidebar
2. The user list shows all accounts with role, status, and last login

**Test deactivate:**
3. Find the Field Officer account (`mohamedamadubangura@gmail.com`)
4. Click the toggle or **Deactivate** button
5. **Expected:** Status changes to Inactive

**Test reactivate:**
6. Click **Activate** to restore access
7. **Expected:** Status changes to Active again

**Create new user:**
8. Click **Add User**
9. Fill in:
   - Full Name: `Test Coordinator`
   - Email: `testcoordinator@agripo.sl`
   - Role: `DistrictCoordinator`
   - Password: `Invendis@2024`
10. Click **Create**

**Expected:** New user appears in the list. They can now log in to the web portal.

---

### Scenario 13 — Audit Log

**Who:** Admin  
**URL:** `/audit`

**Steps:**
1. Navigate to **Audit Log** in the sidebar
2. The paginated log shows every action performed in the system (create, approve, dispatch, login, etc.)
3. Use filters to narrow by:
   - Action type (CREATE, APPROVE, DISPATCH, LOGIN, etc.)
   - Date range
4. **Expected:** Every action from Scenarios 1–12 above appears as an entry with timestamp, user, and description.

---

## PART B — FIELD APP (Mobile)

Use **Expo Go** on your Android or iOS device. Scan the QR code shown in the Expo workflow console.

---

### Scenario 14 — Field Officer Logs In

**Steps:**
1. Open Expo Go → scan the QR code
2. On the Login screen, enter:
   - Email: `mohamedamadubangura@gmail.com`
   - Password: `Invendis@2024`
3. Tap **Sign In**

**Expected:** You land on the Dashboard tab showing:
- Today's PoD count
- Pending sync queue size
- Active dispatches

**Test wrong password:**
4. Log out (if you see a logout option) and try a wrong password
5. **Expected:** Red error banner: "Invalid credentials"

---

### Scenario 15 — Browse Active Dispatches

**Who:** Field Officer (logged in)  
**Tab:** Dispatch (second tab)

**Steps:**
1. Tap the **Dispatch** tab
2. The list shows all dispatches with status `In Transit` or `Approved`
3. Use the search bar to search by manifest code (e.g. `MAN-`)
4. **Expected:** The manifest from Scenario 6 appears

5. Tap the manifest to open its detail page:
   - Manifest code, campaign name, warehouse
   - Items loaded (Improved Rice Seed — 50 units)
   - Driver and vehicle info
   - List of PoDs already submitted for this dispatch

---

### Scenario 16 — Scan a Farmer's Barcode

**Who:** Field Officer  
**Tab:** Scan (third tab)

**Steps (Camera scan):**
1. Tap the **Scan** tab
2. Allow camera permission when prompted
3. Point the camera at the QR code from the farmer's detail page in the web portal (Scenario 3 — Fatmata Koroma)
4. **Expected:** The app beeps/vibrates and navigates to the farmer's profile showing name, district, allocation

**Steps (Manual search):**
5. Tap **Search Manually** (or the search icon)
6. Type `Fatmata`
7. **Expected:** Fatmata Koroma appears in results — tap to open her profile

---

### Scenario 17 — Submit a Proof of Delivery (Full 3-Step Flow)

**Who:** Field Officer  
**Entry:** From the farmer profile found in Scenario 16, tap **Confirm Delivery**

This is the core field workflow.

---

**Step 1 — Delivery Details**

1. The form shows farmer name, campaign, and manifest
2. Fill in:
   - Quantity Delivered: `50`
   - Notes: `Delivered at community centre`
3. Tap **Capture GPS** — the app requests location permission
   - **Expected:** GPS coordinates are captured and displayed (latitude/longitude)
4. Tap **Next**

---

**Step 2 — OTP Verification**

1. Tap **Send OTP** — a 6-digit code is sent to the farmer's registered phone via SMS
2. **Expected:** The button changes to "Resend" and a 60-second cooldown starts
3. Ask the farmer for the code they received and enter it in the 6-digit field
4. Tap **Verify**
   - **Expected:** Green checkmark — "OTP Verified"

**Test wrong code:**
- Enter `000000` → **Expected:** "Invalid or expired code" error

**Test OTP skip (no SMS coverage):**
- Tap **Skip OTP** (amber button)
- Confirm the alert: "This will be flagged for supervisor review"
- **Expected:** Step advances to Face Verification with an amber "OTP Skipped" badge

5. If verified, tap **Next**

---

**Step 3 — Face Verification**

1. Tap **Take Photo** — camera opens
2. Take a clear photo of the farmer's face
3. Tap **Use Photo**
4. The app uploads the photo and compares it against the registered reference photo
5. **Expected results by case:**
   - Photo matches (≥80% similarity) → green "Face Verified" badge
   - Photo doesn't match → red "Match Failed" badge + **Override** button
   - No reference photo on file → amber "No Reference — saved for future" badge

**Test override (if match fails):**
6. Tap **Override** → enter reason: `Farmer does not have reference photo`
7. **Expected:** Override is accepted and flagged for supervisor review

8. Tap **Submit Delivery**

**Expected:** Success screen — "Delivery Confirmed". PoD record is created and visible in the web portal under `/pod`.

---

### Scenario 18 — Submit a PoD While Offline (Queue & Sync)

**Who:** Field Officer

**Steps:**
1. Turn on **Airplane Mode** on your device (disable Wi-Fi and mobile data)
2. Go through Scenarios 16 and 17 again with a different farmer
3. On the final Submit step, tap **Save Offline**
   - **Expected:** The delivery is saved to the offline queue. A badge appears on the **Sync** tab showing pending count.

4. Turn Airplane Mode off (restore connectivity)
5. Tap the **Sync** tab (fifth tab)
6. The pending queue shows the offline PoD
7. Tap **Sync Now**
   - **Expected:** Progress bar runs → "1 record synced successfully"
8. Go back to the web portal `/pod` — the synced PoD should now appear

---

### Scenario 19 — Report a Field Incident

**Who:** Field Officer  
**Tab:** Incidents (fourth tab)

**Steps:**
1. Tap the **Incidents** tab
2. Tap **Report Incident** (or `+` button)
3. Fill in:
   - Type: `Distribution Issue`
   - Description: `Farmer received damaged seed bags — 5 bags rejected`
   - Location: tap **Use Current Location**
4. Tap **Submit**

**Expected:** Incident saved locally and synced. It appears in the incident list with status `Open`.

5. Go to the web portal `/incidents` — the incident appears with the field officer's name.
6. Follow Scenario 10 to resolve it from the web portal.

---

## PART C — CROSS-SYSTEM VERIFICATION

### Scenario 20 — End-to-End Delivery Audit

After completing all scenarios above, verify the full audit trail:

1. **Web portal → `/audit`**
   - Search for actions by the field officer email
   - Expected: LOGIN, POD_SUBMIT (or OTP_BYPASS if skipped), FACE entries all present
   
2. **Web portal → `/pod`**
   - Find the PoD from Scenario 17
   - Verify: GPS coordinates, quantity, OTP status (`Verified` or `SMSBypass`), face status (`Verified`, `Failed`, or `NoReference`)

3. **Web portal → `/reports` → Distribution Report**
   - Find the manifest from Scenario 6
   - Completion % should now reflect the 1 PoD submitted

4. **Web portal → `/reports` → Beneficiary Report**
   - Test District should show 1 approved female farmer (Fatmata Koroma)

---

## Quick Reference — Common Error Messages

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| "Invalid credentials" (login) | Wrong email or password | Check credentials — password is `Invendis@2024` |
| "Account is inactive" (login) | User deactivated | Admin reactivates in `/users` |
| "Account profile not found" (field app) | First mobile login hasn't provisioned yet | Log in once via web portal first |
| "Invalid or expired code" (OTP) | Code expired (10 min) or wrong digits | Tap Resend to get a new code |
| "No farmer found for this barcode" (scan) | Farmer not yet approved | Approve farmer in web portal `/farmers/:id` |
| "Network request failed" (field app) | Device offline or API down | Check connectivity; use Save Offline |
| Sync tab shows pending items | Records saved offline | Tap Sync Now when connected |

---

## Test Checklist

Use this to track your progress:

### Web Portal
- [ ] Login and view dashboard
- [ ] Add district and warehouse (Settings)
- [ ] Register and approve a new farmer
- [ ] Receive stock into warehouse (Inventory)
- [ ] Create and activate a campaign
- [ ] Create dispatch manifest, add items, approve, dispatch
- [ ] View live GPS map (GPS Tracking)
- [ ] View PoD records and filter by status
- [ ] Submit a reconciliation
- [ ] Resolve a field incident
- [ ] Generate all 4 report types
- [ ] Deactivate and reactivate a user
- [ ] Create a new user account
- [ ] View the audit log and verify all actions are recorded

### Field App
- [ ] Login with field officer credentials
- [ ] Browse dispatch list and open manifest detail
- [ ] Scan farmer barcode via camera
- [ ] Search farmer manually
- [ ] Submit PoD — OTP verified path
- [ ] Submit PoD — OTP skipped path (bypass)
- [ ] Submit PoD — face verified path
- [ ] Submit PoD — face override path
- [ ] Save PoD offline and sync later
- [ ] Report a field incident

### Cross-System
- [ ] PoD from field app appears in web portal `/pod`
- [ ] Incident from field app appears in web portal `/incidents`
- [ ] All actions appear in audit log
- [ ] Distribution report shows correct completion percentage
