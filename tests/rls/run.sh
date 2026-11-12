#!/usr/bin/env bash
# Row Level Security tests for supabase/schema*.sql on a throwaway local Postgres (no Supabase account needed).
#   PG=/opt/homebrew/opt/postgresql@17/bin bash tests/rls/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PG="${PG:-/opt/homebrew/opt/postgresql@17/bin}"; PORT="${PORT:-54331}"; DIR="$(mktemp -d /tmp/ep-rls.XXXXXX)"
"$PG/initdb" -D "$DIR/db" -U postgres --auth=trust >/dev/null
"$PG/pg_ctl" -D "$DIR/db" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
trap '"$PG/pg_ctl" -D "$DIR/db" -m immediate stop >/dev/null 2>&1; rm -rf "$DIR"' EXIT
q() { PGOPTIONS="-c client_min_messages=warning" "$PG/psql" -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
q -f "$HERE/supabase-shim.sql"
q -f "$ROOT/supabase/schema.sql"; q -f "$ROOT/supabase/schema-2.sql"
q -f "$ROOT/supabase/schema-3.sql"; q -f "$ROOT/supabase/schema-3.sql" # twice: must be safe to re-run
OUT="$(PGOPTIONS="-c client_min_messages=notice" "$PG/psql" -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -f "$HERE/messaging.sql" 2>&1 | sed -n 's/.*NOTICE:  //p')"
echo "$OUT"
n_ok=$(grep -c '^ok' <<<"$OUT" || true); n_fail=$(grep -c '^FAIL' <<<"$OUT" || true)
echo "$n_ok ok, $n_fail failed"
[ "$n_fail" = 0 ] && [ "$n_ok" -gt 0 ]
