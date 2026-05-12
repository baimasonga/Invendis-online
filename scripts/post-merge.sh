#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Schema management is handled via Supabase SQL Editor directly.
# Do NOT run `pnpm --filter db push` here — Drizzle does not know about
# tables created outside its schema (otp_codes, system_settings) and will
# prompt to drop them, causing data loss.

# Push the latest code to GitHub after every Replit checkpoint.
# Requires GITHUB_PAT (repo scope) to be set in Replit Secrets.
# Missing PAT is a warning — it skips the backup without failing the post-merge.
#
# Note: git remote add/set-url writes temporarily to .git/config;
# the remote is removed immediately after the push.
if [ -z "$GITHUB_PAT" ]; then
  echo "WARN: GITHUB_PAT not set — skipping GitHub backup (set it in Replit Secrets)." >&2
  exit 0
fi

GITHUB_REPO_URL="https://x-access-token:${GITHUB_PAT}@github.com/baimasonga/Invendis-online.git"

# Register (or refresh) the transient 'github' remote
# All git operations run in a subshell so errors never propagate through set -e.
# The backup is best-effort — failure is a warning, not a blocker.
github_backup() {
  local REPO_URL="$1"
  local push_result=0

  if git remote get-url github >/dev/null 2>&1; then
    git remote set-url github "$REPO_URL" || return 1
  else
    git remote add github "$REPO_URL" || return 1
  fi

  # Try normal push first; force only if remote history diverged.
  if ! git push github HEAD:main 2>push_err.txt; then
    if grep -qE "(non-fast-forward|fetch first|unrelated histories)" push_err.txt 2>/dev/null; then
      echo "Remote history diverged — force-pushing to resolve"
      git push --force github HEAD:main 2>>push_err.txt || push_result=1
    else
      push_result=1
    fi
  fi

  git remote remove github 2>/dev/null || true
  rm -f push_err.txt
  return $push_result
}

if github_backup "$GITHUB_REPO_URL"; then
  echo "GitHub backup: pushed HEAD to baimasonga/Invendis-online:main"
else
  echo "WARN: GitHub backup push failed — check GITHUB_PAT has 'Contents: write' (fine-grained) or 'repo' (classic) scope on baimasonga/Invendis-online." >&2
fi
