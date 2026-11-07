#!/usr/bin/env bash
# Runs the SQL tests against the Postgres named by the usual PG* environment
# variables (PGHOST, PGUSER, PGPASSWORD, ...). CI runs this on every pull
# request against a fresh, empty database.
#
# Each psql call is a new connection, so settings a file changes (like the
# database time zone) are in force for the files after it.
set -euo pipefail
cd "$(dirname "$0")/.."

run() { psql -v ON_ERROR_STOP=1 -q -f "$1"; }

run tests/stubs.sql

# The SQL files under test, in the order they are run on the live database.
for file in cyprus-time.sql; do
  run "$file"
done

for test in tests/*.test.sql; do
  echo "== $test"
  run "$test"
done
