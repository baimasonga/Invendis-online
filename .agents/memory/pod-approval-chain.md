---
name: PoD approval chain
description: All side-effects that must fire when a PoD is approved (single or batch)
---
When a PoD is approved (POST /api/pod/:id/approve or /api/pod/batch-approve):
1. pod.status → "Verified"
2. allocations: farmer+campaign row → status "Delivered"
3. campaigns.delivered_count = COUNT(allocations where campaign+Delivered)
4. dispatch_items.quantity_delivered += pod.quantity_delivered (for matching dispatch+input_item)
5. dispatches.delivered_packages = SUM(dispatch_items.quantity_delivered) for that dispatch

**Why:** Steps 4 and 5 were missing — dispatch manifest delivery progress was never tracked.

Approval safety invariants must be enforced inside the guarded database transaction boundary, not only in API routes. Duplicate-flagged PoDs must never reach accounting, and unchecked accounting functions must not be executable by the service role.

**Why:** Single-route validation does not protect batch or future approval entry points; a database-boundary guard prevents double-counting regardless of caller.

**How to apply:** Any new PoD approval path must call the guarded atomic function and preserve duplicate rejection, active approver validation, and all accounting updates in one transaction.
