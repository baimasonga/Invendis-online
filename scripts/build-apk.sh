#!/usr/bin/env bash
# =============================================================================
# build-apk.sh — Build the Invendis Field App APK via EAS
#
# Usage:
#   scripts/build-apk.sh [--profile <profile>] [--no-wait]
#
#   --profile <name>   EAS build profile to use (default: preview)
#   --no-wait          Submit the build and exit immediately (don't poll)
#
# Prerequisites:
#   - EXPO_TOKEN env var must be set (your Expo personal access token)
#   - Run `pnpm install` at the workspace root at least once (provides eas-cli)
#
# Example:
#   EXPO_TOKEN=your_token scripts/build-apk.sh
#   EXPO_TOKEN=your_token scripts/build-apk.sh --profile production --no-wait
# =============================================================================
set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIELD_APP_DIR="$WORKSPACE_ROOT/artifacts/field-app"
PROFILE="preview"
NO_WAIT=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"; shift 2 ;;
    --no-wait)
      NO_WAIT=true; shift ;;
    -h|--help)
      sed -n '/^# Usage/,/^# Example/{ /^#/{ s/^# \?//; p } }' "$0"
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[build-apk]${NC} $*"; }
warn()  { echo -e "${YELLOW}[build-apk]${NC} $*"; }
error() { echo -e "${RED}[build-apk] ERROR:${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
if [[ -z "${EXPO_TOKEN:-}" ]]; then
  error "EXPO_TOKEN is not set."
  error "Generate one at https://expo.dev/settings/access-tokens then:"
  error "  export EXPO_TOKEN=your_token"
  error "  scripts/build-apk.sh"
  exit 1
fi

EAS_BIN="$FIELD_APP_DIR/node_modules/.bin/eas"
if [[ ! -x "$EAS_BIN" ]]; then
  error "eas-cli not found at $EAS_BIN"
  error "Run: pnpm install   (from the workspace root)"
  exit 1
fi

WORKSPACE_YAML="$WORKSPACE_ROOT/pnpm-workspace.yaml"
if [[ ! -f "$WORKSPACE_YAML" ]]; then
  error "pnpm-workspace.yaml not found at $WORKSPACE_YAML"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1 — Read catalog versions from pnpm-workspace.yaml
# ---------------------------------------------------------------------------
log "Reading catalog versions from pnpm-workspace.yaml..."

CATALOG_JSON=$(node -e "
const fs = require('fs');
const yaml = fs.readFileSync('$WORKSPACE_YAML', 'utf8');
const lines = yaml.split('\n');
let inCatalog = false;
const catalog = {};
for (const line of lines) {
  const stripped = line.trim();
  // Detect the catalog: section header (top-level key)
  if (/^catalog:/.test(line)) { inCatalog = true; continue; }
  if (inCatalog) {
    // Skip blank lines and comments
    if (stripped === '' || stripped.startsWith('#')) continue;
    // A non-indented non-comment line means we've left the catalog section
    if (!/^\s/.test(line)) { inCatalog = false; continue; }
    // Match:  'key': value  or  key: value
    const match = line.match(/^\s+['\"]?([@\w\/\.\-]+)['\"]?\s*:\s*(.+?)\s*$/);
    if (match) catalog[match[1]] = match[2];
  }
}
process.stdout.write(JSON.stringify(catalog));
")

log "Catalog loaded: $(echo "$CATALOG_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(Object.keys(d).length+' entries')")"

# ---------------------------------------------------------------------------
# Step 2 — Stage a clean copy of field-app in /tmp
# ---------------------------------------------------------------------------
BUILD_DIR="/tmp/invendis-field-$$"
log "Staging build directory: $BUILD_DIR"

cp -r "$FIELD_APP_DIR" "$BUILD_DIR"

# Remove monorepo-specific files that would confuse EAS
rm -rf "$BUILD_DIR/node_modules"
rm -f  "$BUILD_DIR/pnpm-lock.yaml"

log "Cleaned node_modules and lockfile from staging dir"

# ---------------------------------------------------------------------------
# Step 3 — Resolve catalog: refs in package.json
# ---------------------------------------------------------------------------
log "Resolving catalog: refs in package.json..."

node -e "
const fs = require('fs');
const catalog = $CATALOG_JSON;
const pkgPath = '$BUILD_DIR/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let replaced = 0;
const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
for (const section of sections) {
  if (!pkg[section]) continue;
  for (const [name, ver] of Object.entries(pkg[section])) {
    if (ver === 'catalog:') {
      const resolved = catalog[name];
      if (!resolved) {
        console.error('No catalog entry for: ' + name);
        process.exit(1);
      }
      pkg[section][name] = resolved;
      replaced++;
      console.log('  ' + name + ': catalog: -> ' + resolved);
    }
  }
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Resolved ' + replaced + ' catalog: ref(s)');
"

# ---------------------------------------------------------------------------
# Step 4 — Write a standalone metro.config.js (no workspace root paths)
# ---------------------------------------------------------------------------
log "Writing standalone metro.config.js..."

cat > "$BUILD_DIR/metro.config.js" << 'METRO_EOF'
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Block AWS SDK packages — server-only; should never be bundled in the app
const AWS_PKGS = ["@aws-sdk", "@aws-crypto", "@smithy"];
const blockPatterns = AWS_PKGS.map(
  (pkg) => new RegExp(`node_modules[\\/\\\\]${pkg.replace("/", "[\\/\\\\]")}`)
);

const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, ...blockPatterns]
  : existing instanceof RegExp
  ? [existing, ...blockPatterns]
  : blockPatterns;

module.exports = config;
METRO_EOF

log "Standalone metro.config.js written (no workspace root references)"

# ---------------------------------------------------------------------------
# Step 5 — Run EAS build
# ---------------------------------------------------------------------------
EAS_FLAGS="--platform android --profile $PROFILE --non-interactive"
if $NO_WAIT; then
  EAS_FLAGS="$EAS_FLAGS --no-wait"
fi

log "Submitting EAS build (profile: $PROFILE)..."
log "Command: eas build $EAS_FLAGS"
echo ""

cd "$BUILD_DIR"

EAS_NO_VCS=1 \
EAS_BUILD_SKIP_LOCKFILE_CHECK=1 \
EXPO_TOKEN="$EXPO_TOKEN" \
"$EAS_BIN" build $EAS_FLAGS

echo ""
if $NO_WAIT; then
  log "Build submitted. Monitor progress at: https://expo.dev/accounts/medbangz/projects/field-app/builds"
else
  log "Build complete. The APK download URL is shown above."
  log "You can also find all builds at: https://expo.dev/accounts/medbangz/projects/field-app/builds"
fi

log "Staging dir preserved at: $BUILD_DIR"
log "  (safe to delete: rm -rf $BUILD_DIR)"
