---
name: Profiles table
description: public.profiles exists without auth.users FK; used by mobile login and user management API routes
---
The DATABASE_URL direct connection cannot see the Supabase auth schema, so profiles was created without REFERENCES auth.users. The table has: id UUID PRIMARY KEY, email TEXT UNIQUE, full_name TEXT, role TEXT DEFAULT 'FieldOfficer', district_id INTEGER REFERENCES districts, is_active BOOLEAN DEFAULT TRUE, created_at/updated_at TIMESTAMPTZ.

**Why:** auth.ts mobile login reads profiles for role/is_active. users.ts routes (create-profile, activate, deactivate, role-change, delete, reset-password) all call supa.from("profiles"). Without this table every mobile login and all user management calls fail.

**How to apply:** Any new route that needs Supabase Auth user metadata (role, is_active, district_id) should read from public.profiles, not from auth.users or user_metadata.
