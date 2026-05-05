#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Push the latest code to GitHub after every Replit checkpoint.
# Requires GITHUB_PAT (repo scope) to be set in Replit Secrets.
#
# Note: git remote add/set-url writes temporarily to .git/config.
# The remote is removed immediately after the push.
if [ -z "$GITHUB_PAT" ]; then
  echo "ERROR: GITHUB_PAT is not set — add it in Replit Secrets (repo scope)." >&2
  exit 1
fi

GITHUB_REPO_URL="https://x-access-token:${GITHUB_PAT}@github.com/baimasonga/Invendis-online.git"

# Register (or refresh) the transient 'github' remote
if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$GITHUB_REPO_URL"
else
  git remote add github "$GITHUB_REPO_URL"
fi

# Try a normal push first; only force when the remote history is unrelated or empty
if ! git push github HEAD:main 2>push_err.txt; then
  if grep -qE "(non-fast-forward|fetch first|unrelated histories)" push_err.txt; then
    echo "Remote history diverged — force-pushing to resolve"
    git push --force github HEAD:main
  else
    cat push_err.txt >&2
    git remote remove github
    rm -f push_err.txt
    echo "ERROR: GitHub backup push failed." >&2
    exit 1
  fi
fi

rm -f push_err.txt
git remote remove github
echo "GitHub backup: pushed HEAD to baimasonga/Invendis-online:main"
