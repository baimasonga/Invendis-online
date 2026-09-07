#!/usr/bin/env bash
# Replay schema.sql and every migration into a scratch database, then run the
# SQL regression suites against it. Exits non-zero on the first failed
# assertion.
#
# Uses an existing server when PGHOST is set (a CI service container, say),
# otherwise starts a throwaway cluster from local PostgreSQL binaries. Exits
# 127 when neither is available, which callers treat as "not run" rather than
# "failed".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEST_DB="${PGREGRESSION_DB:-invendis_regression}"
CLUSTER_DIR=""

if [ -n "${PGHOST:-}" ]; then
  # An external server: connect with the standard PG* variables.
  export PGHOST PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
  [ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql not found on PATH; skipping" >&2
    exit 127
  fi
  echo "→ using PostgreSQL at $PGHOST:$PGPORT"
else
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
  if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
    echo "no PGHOST set and no local PostgreSQL server binaries found (set PGBIN); skipping" >&2
    exit 127
  fi
  export PATH="$PGBIN:$PATH"
  export PGPORT="${PGPORT:-55999}" PGUSER=postgres
  CLUSTER_DIR="$(mktemp -d)"
  export PGHOST="$CLUSTER_DIR/socket"
  mkdir -p "$PGHOST"

  # initdb refuses to run as root, so drop to the postgres account when we are.
  AS_PG=""
  if [ "$(id -u)" = "0" ]; then
    AS_PG="postgres"
    chmod 777 "$CLUSTER_DIR" "$PGHOST"
  fi
  run() { if [ -n "$AS_PG" ]; then su "$AS_PG" -c "$1"; else eval "$1"; fi; }

  echo "→ starting a throwaway cluster ($(basename "$PGBIN"))"
  run "$PGBIN/initdb -D $CLUSTER_DIR/data -U postgres -A trust" >/dev/null
  run "$PGBIN/pg_ctl -D $CLUSTER_DIR/data -o '-k $PGHOST -p $PGPORT -c listen_addresses=' -w start" >/dev/null
fi

cleanup() {
  if [ -n "$CLUSTER_DIR" ]; then
    run "$PGBIN/pg_ctl -D $CLUSTER_DIR/data stop -m immediate" >/dev/null 2>&1 || true
    rm -rf "$CLUSTER_DIR"
  else
    psql -q -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1
$PSQL -d postgres -c "CREATE DATABASE $TEST_DB;" >/dev/null
DB="$PSQL -d $TEST_DB"

echo "→ bootstrap"
$DB -f supabase/tests/00_bootstrap.sql >/dev/null
echo "→ schema"
$DB -f supabase/schema.sql >/dev/null
echo "→ migrations"
for f in $(ls supabase/migrations/*.sql | grep -v '/fix_' | sort); do
  $DB -f "$f" >/dev/null
done

status=0
passed=0
for suite in supabase/tests/[23456789]*.sql; do
  echo "→ $(basename "$suite")"
  # Assertions report through NOTICE; a failed one aborts the suite with ERROR.
  if output=$($DB -f "$suite" 2>&1); then
    echo "$output" | grep -E "NOTICE:" | sed 's/.*NOTICE:  //'
    passed=$((passed + $(echo "$output" | grep -c "  ok  " || true)))
  else
    echo "$output" | grep -E "NOTICE:|ERROR" | sed 's/.*NOTICE:  //'
    status=1
  fi
done

if [ "$status" = "0" ]; then
  echo "→ $passed assertions passed"
else
  echo "→ FAILED" >&2
fi
exit $status
