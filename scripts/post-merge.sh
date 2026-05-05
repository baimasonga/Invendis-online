#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

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
if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$GITHUB_REPO_URL"
else
  git remote add github "$GITHUB_REPO_URL"
fi

push_result=0

# Try a normal push first; only force when the remote history is unrelated or empty.
# Capture stderr to a temp file; do NOT echo it raw (may contain the credentialed URL).
if ! git push github HEAD:main 2>push_err.txt; then
  if grep -qE "(non-fast-forward|fetch first|unrelated histories)" push_err.txt; then
    echo "Remote history diverged — force-pushing to resolve"
    if ! git push --force github HEAD:main 2>>push_err.txt; then
      push_result=1
    fi
  else
    push_result=1
  fi
fi

# Always clean up remote and temp file before exiting
git remote remove github
rm -f push_err.txt

if [ "$push_result" -ne 0 ]; then
  echo "ERROR: GitHub backup push failed — check GITHUB_PAT permissions." >&2
  exit 1
fi

echo "GitHub backup: pushed HEAD to baimasonga/Invendis-online:main"
