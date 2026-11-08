#!/usr/bin/env bash
# Runs the SQL tests against the Postgres named by the usual PG* environment
# variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, ...). That database must
# already hold the migrated schema: start it with `npx supabase db start`
# (or `supabase start`), which applies supabase/migrations and seed.sql.
# CI does exactly that on every pull request.
#
# Locally:
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres supabase/tests/run.sh
#
# Each psql call is a new connection, so settings a file changes are in force
# for the files after it.
set -euo pipefail
cd "$(dirname "$0")/.."

for test in tests/*.test.sql; do
  echo "== $test"
  psql -v ON_ERROR_STOP=1 -q -f "$test"
done
