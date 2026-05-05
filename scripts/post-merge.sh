#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Automatically push to GitHub after every Replit checkpoint.
# This hook runs via [postMerge] in .replit after each platform-managed commit.
#
# Security: the PAT is passed to git via an inline credential helper that reads
# from the GITHUB_PAT env var. Nothing is written to .git/config or disk.
if [ -n "$GITHUB_PAT" ]; then
  GITHUB_REPO_URL="https://github.com/baimasonga/Invendis-online.git"
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

  # Use an ephemeral credential helper — PAT never touches .git/config
  CREDENTIAL_HELPER="!f() { echo username=x-access-token; echo password=${GITHUB_PAT}; }; f"

  if git -c "credential.helper=${CREDENTIAL_HELPER}" \
         push "$GITHUB_REPO_URL" "${CURRENT_BRANCH}:${CURRENT_BRANCH}"; then
    echo "GitHub backup: pushed branch '${CURRENT_BRANCH}' to baimasonga/Invendis-online"
  else
    echo "ERROR: GitHub backup push failed for branch '${CURRENT_BRANCH}'." >&2
    echo "The remote may have diverged. Resolve conflicts and push manually." >&2
    exit 1
  fi
else
  echo "ERROR: GITHUB_PAT secret is not set — GitHub backup push cannot proceed." >&2
  echo "Add a GitHub Personal Access Token (repo scope) as the GITHUB_PAT secret in Replit Secrets." >&2
  exit 1
fi
