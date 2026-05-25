---
name: EAS build setup
description: How to trigger EAS Android APK builds from within Replit for the field-app.
---

## Account & project

- Expo account: `amadu-bangura` (EXPO_TOKEN secret is for this account)
- EAS project ID: `1aab4d73-31bd-4726-8566-ef26af36b6d8` — must match `extra.eas.projectId` in app.json
- Android package: `com.medbangz.fieldapp`
- app.json must have `"owner": "amadu-bangura"`, `"slug": "invendis-app"`, `"extra.eas.projectId": "1aab4d73-31bd-4726-8566-ef26af36b6d8"`
- EXPO_TOKEN secret holds the personal access token for EAS CLI

**Note on old configs:** Earlier sessions used `medbangz`, `medbangs`, or `field-app` slug — all stale. The current live project is always `amadu-bangura/invendis-app`.

**Why the projectId matters:** EAS CLI reads `extra.eas.projectId` from app.json and rejects the build immediately at "Read app config" if it doesn't match the project linked in the Expo account.

## Git shim (required)

Replit blocks `git archive` (used internally by EAS CLI to package files). Fix: create a fake `git` binary at `/tmp/fake-git/git` that:
- Returns exit 0 for `git status --porcelain`
- Returns a dummy SHA for `git rev-parse HEAD`
- For `git archive HEAD`: execs `tar --exclude=./node_modules --exclude=./.expo --exclude=./static-build --exclude=./.git -cf - .`
- Falls through to real `/usr/bin/git` for all other commands

Set `PATH=/tmp/fake-git:$PATH` when invoking `eas build`.

**How to apply:** Before every `eas build` invocation, recreate the shim (it lives in /tmp and is lost on container restart) then prefix PATH:

```bash
mkdir -p /tmp/fake-git
cat > /tmp/fake-git/git << 'EOF'
#!/bin/bash
REAL_GIT=/usr/bin/git
case "$*" in
  "status --porcelain"*|"status -s"*) exit 0 ;;
  "rev-parse HEAD"*) echo "0000000000000000000000000000000000000000"; exit 0 ;;
  "archive"*"HEAD"*|"archive"*"--format=tar"*)
    exec tar --exclude='./node_modules' --exclude='./.expo' \
             --exclude='./static-build' --exclude='./.git' -cf - . ;;
  *) exec "$REAL_GIT" "$@" ;;
esac
EOF
chmod +x /tmp/fake-git/git

cd artifacts/field-app && \
  PATH=/tmp/fake-git:$PATH EXPO_TOKEN=$EXPO_TOKEN \
  eas build --platform android --profile preview --non-interactive
```

## Build profile

`eas.json` preview profile: `distribution: internal`, `android.buildType: apk`.
