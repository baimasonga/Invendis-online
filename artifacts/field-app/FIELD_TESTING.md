# Field App — APK Release & Testing Record

## Latest Build

| Field | Value |
|-------|-------|
| Build ID | `96313f0b-ec40-4f35-a778-1fe06449136f` |
| Platform | Android |
| Profile | `preview` (APK, internal distribution) |
| Status | **IN PROGRESS** (started 2026-05-24) |
| API endpoint | `invendisapp.com` |
| Keystore | Build Credentials 74nqzrBtWR (default) |

### Build Dashboard

https://expo.dev/accounts/medbangs/projects/field-app/builds/96313f0b-ec40-4f35-a778-1fe06449136f

> APK download link will appear on the build dashboard above once the build finishes (10–15 min). EAS artifacts expire after 30 days.

---

## Release Verification Sign-Off

> **Instructions:** Once you have installed the APK and completed the checklist below, fill in this section and commit the updated file. This is the in-repo record of sign-off for this release.

| Item | Value |
|------|-------|
| Verified by (name) | ___________________ |
| Device model & OS | ___________________ |
| Date/time | ___________________ |
| Login test result | PASS / FAIL |
| PoD flow result | PASS / FAIL |
| Offline sync result | PASS / FAIL |
| Overall verdict | APPROVED / NEEDS FIXES |
| Notes | ___________________ |

---

## Distribution Log

> **Instructions:** Record every person or group the APK link was sent to. Add a row per recipient group.

| Date sent | Channel | Recipient(s) | Sent by |
|-----------|---------|--------------|---------|
| ___ | WhatsApp / SMS / Email | ___ field officers | ___ |

---

## Distributing to Field Officers

1. Copy the APK download link above and send it via WhatsApp, SMS, or email to field officers.
2. Field officers must enable **"Install from unknown sources"** (or "Install unknown apps") in Android Settings before opening the file.
3. Tap the downloaded `.apk` file and follow the on-screen prompts to install.
4. Open **Invendis Field App**, enter credentials, and proceed with the checklist below.

---

## On-Device Testing Checklist

Complete this checklist on at least one real Android device before signing off on each release. Tick each box as you verify it, then fill in the sign-off table above.

### Login
- [ ] App opens without crash
- [ ] Login screen shows correctly
- [ ] Enter a valid field officer email + password → tap Login
- [ ] Dashboard loads with today's PoD count and active dispatches

### Dispatch Tab
- [ ] Dispatch list loads (active dispatches visible)
- [ ] Search/filter works
- [ ] Tap a dispatch → detail screen opens with manifest items

### Scan Tab
- [ ] Camera permission prompt appears on first use
- [ ] Barcode scan captures a farmer barcode token
- [ ] Manual farmer search works (type name/ID)

### Confirm PoD Flow
- [ ] **Step 1 – Details:** quantity field, GPS capture ("Capture GPS" button works), notes field
- [ ] **Step 2 – OTP:** tap "Send OTP" → SMS received on farmer's phone (or dev bypass banner shown in dev builds)
- [ ] OTP entered → "Verified" confirmation
- [ ] **Step 3 – Face Verification:** camera opens, photo taken, result returned (Verified / NoReference / Failed)
- [ ] PoD submits successfully → appears in dispatch detail

### Offline / Sync Tab
- [ ] Disable mobile data / Wi-Fi → attempt a PoD → saved to offline queue
- [ ] Re-enable connectivity → Sync tab shows pending items → "Sync Now" uploads them

### Incidents Tab
- [ ] "New Incident" button opens the form
- [ ] Fill in description, location → submit → appears in list

---

## Previous Builds

| Date | Build ID | Status | Notes |
|------|----------|--------|-------|
| 2026-05-13 | `98bd4d93-07ff-495a-8456-69409c204b18` | ERRORED | EAS platform outage (high Android error rate) |
| 2026-05-13 | `b3b10169-181f-41fd-9550-eb78d6545001` | FINISHED | Replacement build — current release |
| 2026-05-24 | — | BLOCKED | Free plan monthly Android build quota exhausted; resets 2026-06-01. Project re-linked to `medbangz` account (ID: 38af30b8-d718-443c-8d26-5e527ea4049c). Fixed `app.json` owner typo `medbangs` → `medbangz`. Bundle uploaded OK (57.3 MB). |
