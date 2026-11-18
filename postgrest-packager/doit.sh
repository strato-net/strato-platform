#!/bin/bash
# Runs under "sh" (see the Dockerfile CMD), so keep this POSIX.

set -e
# No "set -x": the trace echoes PGPASSWORD and the rendered db-uri, which
# put the Postgres password into the container log.

if [ -n "${ETHCONF_FILE:-}" ]; then
  PG_ENV_POSTGRES_HOST=$(yq -er '.cirrusConfig.host' "$ETHCONF_FILE")
  PG_PORT_5432_TCP_PORT=$(yq -er '.cirrusConfig.port' "$ETHCONF_FILE")
  PG_ENV_POSTGRES_USER=$(yq -er '.cirrusConfig.user | select(type == "string" and length > 0)' "$ETHCONF_FILE") || {
    echo "ERROR: $ETHCONF_FILE must define a non-empty string for cirrusConfig.user" >&2
    exit 1
  }
  PG_ENV_POSTGRES_DB=$(yq -er '.cirrusConfig.database' "$ETHCONF_FILE")
  PG_ENV_POSTGRES_PASSWORD=$(yq -r '.cirrusConfig.password // ""' "$ETHCONF_FILE")
  POSTGREST_ANONYMOUS=$PG_ENV_POSTGRES_USER
fi

: "${PG_ENV_POSTGRES_USER:?A PostgreSQL username is required in ETHCONF_FILE or PG_ENV_POSTGRES_USER}"

# Read postgres password from mounted secrets file
if [ -f /run/secrets/postgres_password ]; then
  PG_ENV_POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
fi
export PGPASSWORD="${PG_ENV_POSTGRES_PASSWORD:-}"

echo "the pg host and port are: ${PG_ENV_POSTGRES_HOST} ${PG_PORT_5432_TCP_PORT}"

until psql -h "${PG_ENV_POSTGRES_HOST}" -p "${PG_PORT_5432_TCP_PORT}" -U "${PG_ENV_POSTGRES_USER}" -d postgres -c '\q'; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep 1
done

# Per-request statement timeout. slipstream creates public.postgrest_pre_request()
# on the primary (this PostgREST may be reading a replica, where DDL is
# refused); PostgREST calls it inside every request's transaction
# (db-pre-request in postgrest.conf), so the limit covers API queries only,
# never slipstream's own sessions. The value travels on PostgREST's
# connections as strato.postgrest_statement_timeout (see the db-uri in
# postgrest.conf.tpl). 0 disables it. A query the client has already given
# up on (the ALB and nginx cut requests at 60 s) is cancelled instead of
# running on and holding a pool connection.
#
# PostgREST starts without the hook: convoke's `compose up --wait` needs this
# container healthy, so listening, before it launches slipstream, which
# creates the database and the function. The watcher further down adds
# db-pre-request to postgrest.conf and reloads the configuration (SIGUSR2)
# once the function exists.
PRE_REQUEST_SQL="select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'postgrest_pre_request'"
POSTGREST_PRE_REQUEST=""

render_template() {
  eval "echo \"$(sed 's/\"/\\"/g' $1)\""
}

render_template postgrest.conf.tpl > postgrest.conf

# Schema-change watcher.
#
# slipstream creates a table, view and lookup function per contract and tells
# PostgREST about them with "NOTIFY pgrst, 'reload schema'". NOTIFY never
# crosses physical replication, so a PostgREST reading a replica would keep
# serving a stale schema cache forever. Every POSTGREST_SCHEMA_RELOAD_SECONDS
# this fingerprints the exposed schema (relations with their column counts,
# plus functions) and sends PostgREST SIGUSR1, its reload signal, only when
# the fingerprint changes: a reload re-introspects thousands of Cirrus
# tables, so reloading blindly on a timer is not free. 0 disables it.
RELOAD_SECS=${POSTGREST_SCHEMA_RELOAD_SECONDS:-30}
SCHEMA=${POSTGREST_SCHEMA:-public}
FINGERPRINT_SQL="select md5(coalesce(string_agg(x, ',' order by x), '')) from (
  select c.oid::text || ':' || c.relname || ':' || c.relkind || ':'
         || (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = '${SCHEMA}' and c.relkind in ('r','p','v','m','f')
  union all
  select p.oid::text || ':' || p.proname || ':' || p.pronargs as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = '${SCHEMA}'
) s"

schema_fingerprint() {
  psql -h "${PG_ENV_POSTGRES_HOST}" -p "${PG_PORT_5432_TCP_PORT}" -U "${PG_ENV_POSTGRES_USER}" \
       -d "${PG_ENV_POSTGRES_DB}" -Atq -c "$FINGERPRINT_SQL" 2>/dev/null || true
}

postgrest postgrest.conf &
PG_PID=$!

# Forward a stop to PostgREST and wait for it, so the container exits cleanly.
trap 'kill -TERM "$PG_PID" 2>/dev/null; wait "$PG_PID"; exit 0' TERM INT

# Statement-timeout hook: see PRE_REQUEST_SQL above. PostgREST must be
# answering HTTP before it is signalled: until its handlers are installed a
# SIGUSR2 would terminate it instead of reloading the configuration.
if [ "${POSTGREST_STATEMENT_TIMEOUT:-60s}" != "0" ]; then
  (
    while kill -0 "$PG_PID" 2>/dev/null; do
      if curl -s -o /dev/null "http://127.0.0.1:${POSTGREST_LISTEN_PORT}/" && [ "$(psql -h "${PG_ENV_POSTGRES_HOST}" -p "${PG_PORT_5432_TCP_PORT}" -U "${PG_ENV_POSTGRES_USER}" -d "${PG_ENV_POSTGRES_DB}" -Atq -c "$PRE_REQUEST_SQL" 2>/dev/null)" = 1 ]; then
        POSTGREST_PRE_REQUEST='db-pre-request = "public.postgrest_pre_request"'
        render_template postgrest.conf.tpl > postgrest.conf
        kill -USR2 "$PG_PID" 2>/dev/null || true
        echo "statement timeout: public.postgrest_pre_request() is in place, db-pre-request enabled"
        exit 0
      fi
      sleep 5
    done
  ) &
fi

if [ "$RELOAD_SECS" -gt 0 ] 2>/dev/null; then
  (
    set +x
    last=""
    while kill -0 "$PG_PID" 2>/dev/null; do
      sleep "$RELOAD_SECS"
      fp=$(schema_fingerprint)
      [ -n "$fp" ] || continue
      if [ "$fp" != "$last" ]; then
        if [ -n "$last" ]; then
          echo "schema watcher: exposed schema changed, reloading PostgREST's schema cache"
          kill -USR1 "$PG_PID" 2>/dev/null || true
        fi
        last=$fp
      fi
    done
  ) &
fi

wait "$PG_PID"
