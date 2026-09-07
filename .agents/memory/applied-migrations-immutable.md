---
name: Applied migrations are immutable
description: How to deliver corrections discovered after a Supabase migration has already run
---
Once a migration is recorded in the live Supabase ledger, treat its contents as immutable. Put every later correction in a new forward migration, even when fresh-database tests pass after editing the old file.

**Why:** Migration runners do not rerun an applied filename. Editing historical SQL can make tests and new environments correct while leaving the live function or schema unchanged.

**How to apply:** Confirm the live migration ledger, restore the historical file, add a later migration that replaces or alters the affected object, test the migrations in order, apply the new migration, and verify the installed database definition.