---
name: Beneficiary types in farmers table
description: How individual vs group beneficiaries are stored and displayed
---

# Beneficiary Types

Farmers/beneficiaries can be Individual or Group (cooperative/association).

**Schema columns added:**
- `beneficiary_type` TEXT NOT NULL DEFAULT 'individual' — values: 'individual', 'group'
- `group_size` INTEGER nullable — number of members (groups only)
- `farmer_group` TEXT nullable — already existed; used as cooperative name for groups, or the group a farmer belongs to for individuals

**Data conventions:**
- Group records: `farmer_group` = cooperative name (required), `first_name`/`last_name` = contact person (optional, "—" if not provided), `gender` = "N/A"
- Individual records: `farmer_group` = optional cooperative membership; normal name/gender fields

**Why:** Agricultural programs in Sierra Leone distribute to both individual farmers and farmer cooperatives/associations as a unit.

**How to apply:** Anywhere that displays or processes farmer records, check `beneficiary_type === 'group'` to determine display label (use `farmer_group` as primary name) vs `'individual'` (use `first_name + last_name`).
