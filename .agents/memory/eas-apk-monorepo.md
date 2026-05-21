---
name: EAS Android APK build from pnpm monorepo
description: How to trigger EAS builds for field-app when git and direct workspace context are unavailable; all blockers and fixes encountered.
---

## The rule
To build the field-app APK with EAS from within the Replit main-agent sandbox:
1. Copy `artifacts/field-app` to `/tmp/invendis-field`
2. Set `EAS_NO_VCS=1` (no git) and `EAS_BUILD_SKIP_LOCKFILE_CHECK=1`
3. Replace `catalog:` entries in `package.json` with real semver versions from `pnpm-workspace.yaml`
4. Replace `metro.config.js` with a standalone version (no `../../` workspace root refs)
5. Delete `node_modules` and `pnpm-lock.yaml` from the tmp dir before upload
6. Run EAS CLI from `/home/runner/workspace/artifacts/field-app/node_modules/.bin/eas`

**Why:** Git operations (`git init`, `git archive`) are blocked in the main agent. The workspace `pnpm-lock.yaml` in the tmp dir causes install failures. `catalog:` package refs and monorepo `metro.config.js` paths cause EAS build server failures.

**How to apply:** Any time a new APK build is needed, apply the same 6-step procedure above.

## Catalog versions (as of May 2026)
- `@tanstack/react-query`: `^5.90.21`
- `react`: `19.1.0`
- `react-dom`: `19.1.0`
- `zod`: `^3.25.76`

## Standalone metro.config.js
Remove all `watchFolders` and `nodeModulesPaths` that reference `../../` (workspace root). Keep only the AWS SDK block list. EAS installs fresh deps into project root so no external node_modules path is needed.

## EAS project details
- Owner: `medbangz`, slug: `field-app`, projectId: `38af30b8-d718-443c-8d26-5e527ea4049c`
- Build profile `preview`: `buildType: "apk"`, env `EXPO_PUBLIC_DOMAIN: "invendisapp.com"`
- Poll builds: `POST https://api.expo.dev/graphql` with `Authorization: Bearer $EXPO_TOKEN`

## Successful build IDs
- `584bdd35-374f-4553-9a68-de950457ba71` — FINISHED, APK: `https://expo.dev/artifacts/eas/bUooV2fAQyYLnPVUbSNgMk.apk`
