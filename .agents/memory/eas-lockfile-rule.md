---
name: EAS build lockfile rule
description: EAS Build fails if pnpm-lock.yaml is not in sync with package.json — must run pnpm install and push lockfile after every package change.
---

## Rule

Any time a package is added or removed from `artifacts/field-app/package.json` (or any workspace `package.json`), you MUST run `pnpm install` at the workspace root and push the updated `pnpm-lock.yaml` to GitHub before triggering an EAS build.

**Why:** EAS Build runs `pnpm install --frozen-lockfile` inside the build environment. If the lockfile's specifiers don't match `package.json`, the build fails immediately at "Install dependencies" with `ERR_PNPM_OUTDATED_LOCKFILE`.

**How to apply:**
1. Edit `package.json` (add/remove packages)
2. Run `pnpm install` at workspace root
3. Push both `package.json` AND `pnpm-lock.yaml` to GitHub
4. Only then trigger `eas build`

This is a CI-only constraint — local dev (`pnpm install` without `--frozen-lockfile`) never hits it. The symptom is always the same error message listing the added/removed packages as the mismatch.
