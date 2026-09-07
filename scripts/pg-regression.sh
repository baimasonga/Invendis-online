#!/usr/bin/env bash
# Replay schema.sql and every migration into a throwaway PostgreSQL cluster,
# then run the SQL regression suites against it. Exits non-zero on the first
# failed assertion.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "postgres server binaries not found (set PGBIN); skipping" >&2
  exit 127
fi

PORT="${PGPORT:-55999}"
DATADIR="$(mktemp -d)/data"
SOCKET="$(mktemp -d)"
OWNER="$(id -u)"
RUN=""
# initdb refuses to run as root, so drop to the postgres account when we are.
if [ "$OWNER" = "0" ]; then
  RUN="su postgres -c"
  chmod 777 "$(dirname "$DATADIR")" "$SOCKET"
fi

run() { if [ -n "$RUN" ]; then su postgres -c "$1"; else eval "$1"; fi; }

cleanup() {
  run "$PGBIN/pg_ctl -D $DATADIR stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$DATADIR")" "$SOCKET"
}
trap cleanup EXIT

run "$PGBIN/initdb -D $DATADIR -U postgres -A trust" >/dev/null
run "$PGBIN/pg_ctl -D $DATADIR -o '-k $SOCKET -p $PORT -c listen_addresses=' -w start" >/dev/null

PSQL="psql -h $SOCKET -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "CREATE DATABASE invendis_test;" >/dev/null
DB="$PSQL -d invendis_test"

echo "→ bootstrap"
$DB -f supabase/tests/00_bootstrap.sql >/dev/null
echo "→ schema"
$DB -f supabase/schema.sql >/dev/null
echo "→ migrations"
for f in $(ls supabase/migrations/*.sql | grep -v '/fix_' | sort); do
  $DB -f "$f" >/dev/null
done

status=0
for suite in supabase/tests/[23456789]*.sql; do
  echo "→ $(basename "$suite")"
  if ! $DB -f "$suite" 2>&1 | grep -E "^(psql:|NOTICE:|ERROR)" | sed 's/^NOTICE:  //'; then
    status=1
  fi
done
exit $status
