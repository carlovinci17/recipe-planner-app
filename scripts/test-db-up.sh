#!/usr/bin/env bash
#
# Stand up a disposable Postgres for the integration suites, with production's
# exact schema.
#
# Two decisions worth knowing:
#
# 1. NOT the local Supabase stack. It is still installable and its Postgres
#    happens to ship the `authenticated` role the app needs — but depending on
#    `supabase start` to test a Supabase-free app re-introduces the CLI
#    dependency the Module 11 decommission removed.
#
# 2. The schema is CLONED FROM NEON, not replayed from supabase/migrations/.
#    Those migrations are not replayable on a bare Postgres: the first one does
#    `references auth.users(id)` and installs a trigger on `auth.users`, both
#    Supabase Auth objects. Module 9 moved to Neon by importing a dump, not by
#    replaying history, and the live schema has no FK to auth.* at all. So the
#    dump is the truth and a replay would test a schema that exists nowhere.
#
# pgvector/pgvector because `recipes.embedding` is `vector(1536)`; citext,
# pg_trgm and pgcrypto are contrib and already in the image.
#
# PINNED TO pg18 to match Neon. pg_dump refuses to dump a server newer than
# itself ("aborting because of server version mismatch"), and Neon is on 18.6 —
# so a pg16 image cannot clone it. Bump this when Neon's major version moves.
#
# Idempotent — recreates the container from scratch, which is what you want for
# a suite that seeds and deletes.
#
#   bash scripts/test-db-up.sh          # start + clone schema
#   bash scripts/test-db-up.sh --down   # remove
#
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="recipe-planner-testdb"
PORT="55432"
PASS="testpass"
URL="postgresql://postgres:${PASS}@127.0.0.1:${PORT}/postgres"

if [ "${1:-}" = "--down" ]; then
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  echo "removed ${NAME}"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running" >&2
  exit 1
fi

# Read the connection string out of .env.local rather than sourcing it: the file
# is data, not shell, and one value containing a quote or a space would break
# `.` in ways that are tedious to debug. Never echoed.
SRC="${NEON_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "${SRC}" ] && [ -f .env.local ]; then
  SRC=$(grep -m1 -E '^NEON_DATABASE_URL=' .env.local | cut -d= -f2- || true)
  [ -z "${SRC}" ] && SRC=$(grep -m1 -E '^DATABASE_URL=' .env.local | cut -d= -f2- || true)
fi
if [ -z "${SRC}" ]; then
  echo "ERROR: NEON_DATABASE_URL (or DATABASE_URL) must be set — it is the schema source." >&2
  echo "       Run: bash scripts/pull-local-env.sh" >&2
  exit 1
fi

echo "- recreating ${NAME} on :${PORT}"
docker rm -f "${NAME}" >/dev/null 2>&1 || true
docker run -d --name "${NAME}" \
  -e POSTGRES_PASSWORD="${PASS}" \
  -p "${PORT}:5432" \
  pgvector/pgvector:pg18 >/dev/null

echo "- waiting for it to accept connections"
for _ in $(seq 1 60); do
  docker exec "${NAME}" pg_isready -U postgres -q 2>/dev/null && break
  sleep 1
done
if ! docker exec "${NAME}" pg_isready -U postgres -q 2>/dev/null; then
  echo "ERROR: database did not come up" >&2
  docker logs --tail 20 "${NAME}" >&2
  exit 1
fi

# Dump from Neon using the container's own pg_dump, so no local client is
# needed. --no-owner/--no-privileges drops the `neondb_owner` grants that do not
# exist here; roles are applied separately below. Schema only — never data.
echo "- cloning the schema from Neon (read-only, schema only)"
if ! docker exec -e PGCONN="${SRC}" "${NAME}" sh -c \
     'pg_dump --schema-only --no-owner --no-privileges --schema=public --schema=auth \
        --exclude-schema=information_schema "$PGCONN"' \
     > /tmp/neon-schema.sql 2>/tmp/neon-dump-err; then
  echo "ERROR: pg_dump failed:" >&2
  tail -5 /tmp/neon-dump-err >&2
  exit 1
fi
echo "  $(wc -l < /tmp/neon-schema.sql | tr -d ' ') lines"

# Extensions FIRST. `pg_dump --schema=public` filters out CREATE EXTENSION
# (an extension belongs to the database, not a schema), so the dump references
# public.citext and public.vector without ever creating them.
echo "- extensions"
docker exec "${NAME}" psql -U postgres -d postgres -q \
  -c 'drop schema if exists auth cascade' \
  -c 'create extension if not exists citext' \
  -c 'create extension if not exists vector' \
  -c 'create extension if not exists pg_trgm' \
  -c 'create extension if not exists pgcrypto'

# The role must exist BEFORE the load: every RLS policy in the dump names
# `authenticated` as its grantee, and Postgres will not create a policy for a
# role that does not exist. The grants come after, once there are tables.
docker exec "${NAME}" psql -U postgres -d postgres -q \
  -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end \$\$"

echo "- loading it"
# Strip the dump's own `CREATE SCHEMA public` — a fresh image already has one,
# and keeping it there is what the extensions above installed into.
if ! docker exec -i "${NAME}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
     < <(grep -vE '^CREATE SCHEMA public;$' /tmp/neon-schema.sql) 2>/tmp/neon-load-err; then
  echo "ERROR loading schema:" >&2
  grep -v '^NOTICE' /tmp/neon-load-err | tail -8 >&2
  exit 1
fi

# `authenticated` + grants. This is what makes RLS engage the same way it does
# on Neon: withUserContext does `set local role authenticated`.
echo "- roles (authenticated + grants)"
sed 's/neondb_owner/postgres/g' scripts/neon-roles.sql \
  | docker exec -i "${NAME}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q

TABLES=$(docker exec "${NAME}" psql -U postgres -d postgres -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
echo
echo "OK — ${TABLES} public tables."
echo "  TEST_DATABASE_URL=${URL}"
