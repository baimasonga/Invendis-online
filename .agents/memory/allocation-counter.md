---
name: Allocation counter sync
description: campaigns.allocated_farmers must be updated after every allocation insert
---
After POST /api/allocations or /api/allocations/bulk, the route recounts allocations for the campaign and writes campaigns.allocated_farmers = count.

**Why:** The column existed but was never written; campaign summary cards showed 0 allocated farmers even when allocations existed.

**How to apply:** Any code that inserts into allocations must follow with a count+update on campaigns.allocated_farmers.
