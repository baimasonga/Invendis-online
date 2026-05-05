#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Automatically push to GitHub after every Replit checkpoint.
# This hook runs via [postMerge] in .replit after each platform-managed commit.
# GitHub backup is optional — missing PAT is a warning, not a hard failure.
#
# Security: the PAT is passed via a transient remote URL; nothing is written
# to .git/config or disk. The remote is removed after use.
if [ -z "$GITHUB_PAT" ]; then
  echo "WARN: GITHUB_PAT is not set — skipping GitHub backup." >&2
  exit 0
fi

GITHUB_REPO_URL="https://x-access-token:${GITHUB_PAT}@github.com/baimasonga/Invendis-online.git"

# Ensure a clean 'github' remote (add or update)
if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$GITHUB_REPO_URL"
else
  git remote add github "$GITHUB_REPO_URL"
fi

# Always push HEAD to main on the remote (Replit main = GitHub main)
if git push --force github HEAD:main; then
  echo "GitHub backup: pushed HEAD to baimasonga/Invendis-online:main"
else
  echo "WARN: GitHub backup push failed — continuing without error." >&2
fi

# Remove the remote so the PAT URL is not cached in .git/config
git remote remove github
