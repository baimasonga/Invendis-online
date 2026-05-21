---
name: Stock balance lifecycle
description: How stock moves through available → loaded → delivered columns in stock_balance
---
stock_balance has columns: available, reserved, loaded, delivered, returned, damaged.

Flow:
1. Receive stock → available += qty (receive-stock route)
2. Transfer → available moves between warehouses (transfer-stock route)
3. Dispatch "In Transit" → available -= qty, loaded += qty (dispatch.ts /:id/dispatch)
4. PoD approve → dispatch_items.quantity_delivered updated; dispatches.delivered_packages recalculated (pod.ts approve/batch-approve)

**Why:** Stock was previously never deducted when a vehicle left the warehouse, causing stock_balance.available to be permanently inflated.

**How to apply:** stock_balance has UNIQUE constraint on (warehouse_id, input_item_id) — always use upsert or update-by-id, never raw insert.
