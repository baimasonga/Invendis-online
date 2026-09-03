#!/bin/bash
set -e

# Runs after Replit pulls new code. Replit is a RUNTIME ONLY — it does not
# author or publish code. All development happens outside Replit and lands on
# GitHub main; Replit's job is to install deps and run what it was given.
pnpm install --frozen-lockfile

# Schema management is handled via Supabase SQL Editor directly.
# Do NOT run `pnpm --filter db push` here — Drizzle does not know about
# tables created outside its schema (otp_codes, system_settings) and will
# prompt to drop them, causing data loss.

# ── Why there is no git push here ────────────────────────────────────────────
# This script used to push Replit's working tree back to GitHub main, and would
# `git push --force` whenever histories had diverged. That silently destroyed
# work: any commit pushed to main from elsewhere made the histories diverge, so
# the next Replit checkpoint force-pushed over it. Fixes that were lost this way
# include the GPS geofence coordinate fix and the babel-preset-expo dependency
# (whose loss broke ~26 consecutive Android builds).
#
# main is the source of truth and Replit consumes it one-way. If you need to
# capture work done inside Replit, commit it and open a PR — never force-push.
echo "post-merge: dependencies installed (Replit runs code; it does not publish it)"
