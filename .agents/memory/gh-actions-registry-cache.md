---
name: GitHub Actions broken workflow registry
description: When a workflow file is first pushed with invalid YAML/schema, GitHub caches the broken parse forever under that workflow ID — fixing the file content does not re-register it.
---

## The rule

If a GitHub Actions workflow file was first committed with invalid content (YAML parse error or schema validation failure), GitHub registers the workflow with the **file path as its name** (e.g. `.github/workflows/foo.yml` instead of the `name:` field value). Subsequent pushes that fix the content are parsed for job execution but do NOT update the workflow registry entry — the name stays as the file path and the workflow continues to produce 0 jobs.

**Why:** GitHub caches the workflow definition at registration time (first valid push per unique file path). A broken first push leaves a permanently stale registry entry for that workflow ID.

**How to detect:** `GET /repos/{owner}/{repo}/actions/workflows` → if `name` equals the `path` (e.g. `.github/workflows/foo.yml`), the workflow was never successfully parsed.

**Fix:** Delete the file from GitHub, then recreate it under a **different filename**. The new filename gets a fresh workflow ID and is parsed from scratch.

**How to avoid:** Always write workflow YAML to a local file first (verified with `JSON.stringify(line)` per line to check indentation/encoding), then upload via `GET sha` → `PUT`. Never generate YAML content via JavaScript template literals that are indented inside a code block — the template literal will inherit the surrounding indentation, producing extra leading spaces on all lines after the first.

## Confirmed broken workflows in this repo

- `android-native-build.yml` — broken from its first commit; deleted
- `build-android-apk.yml` — first upload had 2-space extra indent on all lines due to JS template literal issue; deleted

## Current working android CI (as of May 2026)

`build-android.yml` — workflow ID 282585497, name "Build Mobile App — Android". Has two jobs:
1. `typecheck` — runs pnpm install --frozen-lockfile, typecheck:libs, field-app typecheck
2. `build-android` (needs: typecheck) — expo prebuild + assembleDebug
