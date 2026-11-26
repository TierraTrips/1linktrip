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
q -f "$ROOT/supabase/schema-4.sql"; q -f "$ROOT/supabase/schema-4.sql"
q -f "$ROOT/supabase/schema-5.sql"; q -f "$ROOT/supabase/schema-5.sql"
[ -n "${EXTRA_SQL:-}" ] && q -f "$EXTRA_SQL" # e.g. a part not committed yet, to test against it
q -f "$ROOT/supabase/schema-6.sql"; q -f "$ROOT/supabase/schema-6.sql"
q -f "$ROOT/supabase/schema-names.sql"; q -f "$ROOT/supabase/schema-names.sql"
q -f "$ROOT/supabase/schema-seating.sql"; q -f "$ROOT/supabase/schema-seating.sql"
q -f "$ROOT/supabase/schema-invites.sql"; q -f "$ROOT/supabase/schema-invites.sql"
q -f "$ROOT/supabase/schema-arrivals.sql"; q -f "$ROOT/supabase/schema-arrivals.sql"
q -f "$ROOT/supabase/schema-shuttles.sql"; q -f "$ROOT/supabase/schema-shuttles.sql"
OUT="$(PGOPTIONS="-c client_min_messages=notice" "$PG/psql" -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -f "$HERE/messaging.sql" -f "$HERE/private.sql" -f "$HERE/shares.sql" -f "$HERE/names.sql" -f "$HERE/team.sql" -f "$HERE/seating.sql" -f "$HERE/invites.sql" -f "$HERE/arrivals.sql" -f "$HERE/shuttles.sql" 2>&1 | sed -n 's/.*NOTICE:  //p')"
echo "$OUT"
n_ok=$(grep -c '^ok' <<<"$OUT" || true); n_fail=$(grep -c '^FAIL' <<<"$OUT" || true)
echo "$n_ok ok, $n_fail failed"
[ "$n_fail" = 0 ] && [ "$n_ok" -gt 0 ]
