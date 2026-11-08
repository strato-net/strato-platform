#!/bin/sh
set -eu

export PGHOST="${PG_ADMIN_HOST:?}" PGPORT="${PG_ADMIN_PORT:-5432}" PGUSER="${PG_ADMIN_USER:-postgres}"
export PGPASSWORD="$(cat /run/secrets/postgres_password)"

psql -X -v ON_ERROR_STOP=1 -d postgres -f /strato/pg-roles.sql

db_name() { yq "$1" /config/ethconf.yaml; }
eth_db=$(db_name '.sqlConfig.database')
cirrus_db=$(db_name '.cirrusConfig.database')
peer_db=$(db_name '.peerDbConfig.database // ""')

prepare_db() {
  db=$1 owner=$2
  [ -n "$db" ] || return 0
  psql -X -v ON_ERROR_STOP=1 -d postgres -v db="$db" -v owner="$owner" <<'SQL'
SELECT pg_advisory_lock(617074, hashtext(:'db'));
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'owner')
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db')
\gexec
SELECT pg_advisory_unlock(617074, hashtext(:'db'));
SQL
  psql -X -v ON_ERROR_STOP=1 -d "$db" -v owner="$owner" -v source_owner="$PGUSER" -f /strato/pg-migrate-schema.sql
}

prepare_db "$eth_db" strato_eth
if [ -n "$peer_db" ] && [ "$peer_db" != "$eth_db" ]; then
  prepare_db "$peer_db" strato_eth
fi
if [ "${PG_HAS_CIRRUS:-true}" = true ]; then
  prepare_db "$cirrus_db" strato_cirrus
  psql -X -v ON_ERROR_STOP=1 -d "$cirrus_db" -v db="$cirrus_db" <<'SQL'
SELECT format('GRANT CONNECT ON DATABASE %I TO strato_app, strato_postgrest, strato_cirrus_anon', :'db')
\gexec
GRANT USAGE ON SCHEMA public TO strato_app, strato_postgrest, strato_cirrus_anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM strato_postgrest, strato_cirrus_anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM strato_postgrest, strato_cirrus_anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM strato_postgrest, strato_cirrus_anon;
-- Expose Cirrus-owned relations, leaving any extension or independently owned
-- relation in public outside the anonymous API.
SELECT format('GRANT SELECT ON TABLE %I.%I TO strato_app, strato_cirrus_anon',
              n.nspname, c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND pg_get_userbyid(c.relowner) = 'strato_cirrus'
\gexec
ALTER DEFAULT PRIVILEGES FOR ROLE strato_cirrus IN SCHEMA public GRANT SELECT ON TABLES TO strato_app;
ALTER DEFAULT PRIVILEGES FOR ROLE strato_cirrus IN SCHEMA public GRANT SELECT ON TABLES TO strato_cirrus_anon;
-- Regrant only Slipstream's read-only computed relationships on existing
-- databases. New relationships receive their grant when Slipstream creates them.
SELECT format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO strato_cirrus_anon',
              n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  JOIN pg_type source_type ON source_type.oid = p.proargtypes[0]
  JOIN pg_type result_type ON result_type.oid = p.prorettype
 WHERE n.nspname = 'public'
   AND source_type.typnamespace = n.oid AND result_type.typnamespace = n.oid
   AND pg_get_userbyid(p.proowner) = 'strato_cirrus'
   AND l.lanname = 'sql' AND p.provolatile = 's' AND p.proretset
   AND p.pronargs = 1 AND NOT p.prosecdef
   AND btrim(p.prosrc) LIKE 'SELECT v.*%'
\gexec
SQL
fi
if [ "${PG_HAS_APEX:-false}" = true ]; then
  prepare_db apex_prod strato_apex
  psql -X -v ON_ERROR_STOP=1 -d "$eth_db" -v db="$eth_db" <<'SQL'
SELECT format('GRANT CONNECT ON DATABASE %I TO strato_apex', :'db')
\gexec
GRANT USAGE ON SCHEMA public TO strato_apex;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO strato_apex;
ALTER DEFAULT PRIVILEGES FOR ROLE strato_eth IN SCHEMA public GRANT SELECT ON TABLES TO strato_apex;
SQL
fi
if [ "${PG_HAS_LOCAL_AUTH:-false}" = true ]; then
  if [ "${LOCAL_AUTH_RESET:-false}" = true ]; then
    psql -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN ('kratos', 'hydra') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS kratos;
DROP DATABASE IF EXISTS hydra;
SQL
  fi
  prepare_db kratos strato_auth
  prepare_db hydra strato_auth
  prepare_db oauth strato_vault
fi
if [ "${PG_HAS_HISTORY:-false}" = true ]; then
  prepare_db history strato_history
fi

echo 'PostgreSQL runtime roles and ownership are ready'
