#!/bin/sh
set -eu

export PGHOST="${PG_ADMIN_HOST:?}" PGPORT="${PG_ADMIN_PORT:-5432}" PGUSER="${PG_ADMIN_USER:-postgres}"
export PGPASSWORD="$(cat /run/secrets/postgres_password)"
export PGCONNECT_TIMEOUT=3

attempt=0
until error=$(psql -X -Atqc 'SELECT 1' -d postgres 2>&1 >/dev/null); do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "PostgreSQL administrator connection failed at $PGHOST:$PGPORT: $error" >&2
    exit 1
  fi
  sleep 2
done

psql -X -v ON_ERROR_STOP=1 -d postgres -f /strato/pg-roles.sql

db_name() { yq "$1" /config/ethconf.yaml; }
eth_db=$(db_name '.sqlConfig.database')
cirrus_db=$(db_name '.cirrusConfig.database')
peer_db=$(db_name '.peerDbConfig.database // ""')

# A statement here and Slipstream on the primary (CREATE OR REPLACE FUNCTION,
# DROP VIEW, ALTER TABLE) can rewrite the same catalog row; PostgreSQL then
# fails one side with "tuple concurrently updated/deleted" or a deadlock, and
# this side repeats the run. The SQL comes on stdin.
retry_psql() {
  sql=$(cat)
  attempt=0
  until output=$(printf '%s\n' "$sql" | psql -X -v ON_ERROR_STOP=1 "$@" 2>&1); do
    attempt=$((attempt + 1))
    case $output in
      *'tuple concurrently '*|*'deadlock detected'*)
        if [ "$attempt" -lt 5 ]; then
          echo "pg-init: catalog row changed concurrently, retrying (attempt $attempt)" >&2
          sleep 1
          continue
        fi ;;
    esac
    printf '%s\n' "$output" >&2
    return 1
  done
  printf '%s\n' "$output"
}

# prepare_db <database> <owner role> [<roles granted CONNECT>]: CREATE/ALTER
# DATABASE and the CONNECT privileges all run here, under the one lock, so two
# provisioners never update the database's pg_database row at the same time.
prepare_db() {
  db=$1 owner=$2 connect_roles=${3:-}
  [ -n "$db" ] || return 0
  psql -X -v ON_ERROR_STOP=1 -d postgres -v db="$db" -v owner="$owner" -v connect_roles="$connect_roles" <<'SQL'
SELECT pg_advisory_lock(617074, hashtext(:'db'));
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'owner')
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %s', :'db', :'connect_roles')
 WHERE :'connect_roles' <> ''
\gexec
SELECT pg_advisory_unlock(617074, hashtext(:'db'));
SQL
  retry_psql -d "$db" -v owner="$owner" -v source_owner="$PGUSER" < /strato/pg-migrate-schema.sql
}

eth_connect_roles=
if [ "${PG_HAS_APEX:-false}" = true ]; then
  eth_connect_roles=strato_apex
fi
prepare_db "$eth_db" strato_eth "$eth_connect_roles"
if [ -n "$peer_db" ] && [ "$peer_db" != "$eth_db" ]; then
  prepare_db "$peer_db" strato_eth
fi
if [ "${PG_HAS_CIRRUS:-true}" = true ]; then
  prepare_db "$cirrus_db" strato_cirrus 'strato_app, strato_postgrest, strato_cirrus_anon'
  # One short transaction under the database's advisory lock (the one
  # pg-migrate-schema.sql holds): a PostgREST already serving this database
  # from another core never sees the revocations without the regrants, and
  # concurrent provisioners refresh in turn. Only objects whose privileges
  # differ from the intended ones are touched: GRANT and REVOKE rewrite the
  # catalog row even when nothing changes, and such a rewrite meeting
  # Slipstream's DDL on the primary fails one of the two.
  retry_psql -d "$cirrus_db" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(617074, hashtext(current_database()));
DO $refresh$
DECLARE
  r record;
  fixes text[] := '{}';
  stmt text;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('strato_app', 'strato_postgrest', 'strato_cirrus_anon')
       AND NOT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                        WHERE n.nspname = 'public' AND a.grantee = pg_roles.oid AND a.privilege_type = 'USAGE')
  LOOP
    fixes := fixes || format('GRANT USAGE ON SCHEMA public TO %I', r.rolname);
  END LOOP;

  -- Cirrus-owned tables and views are readable by strato_app and
  -- strato_cirrus_anon, who hold nothing else here (extension or independently
  -- owned relations stay outside the anonymous API); strato_postgrest holds
  -- nothing directly and SET ROLEs to strato_cirrus_anon. A privilege held
  -- WITH GRANT OPTION counts as different ('*').
  FOR r IN
    SELECT format('%I.%I', n.nspname, c.relname) AS name,
           CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind,
           CASE WHEN c.relkind <> 'S' AND pg_get_userbyid(c.relowner) = 'strato_cirrus' THEN ARRAY['SELECT'] END AS wanted,
           acl.anon, acl.app, acl.postgrest
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL (
        SELECT array_agg(q.priv ORDER BY q.priv) FILTER (WHERE a.grantee = 'strato_cirrus_anon'::regrole) AS anon,
               array_agg(q.priv ORDER BY q.priv) FILTER (WHERE a.grantee = 'strato_app'::regrole) AS app,
               coalesce(bool_or(a.grantee = 'strato_postgrest'::regrole), false) AS postgrest
          FROM aclexplode(c.relacl) a
          CROSS JOIN LATERAL (SELECT a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END AS priv) q) acl
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  LOOP
    IF r.postgrest THEN
      fixes := fixes || format('REVOKE ALL ON %s %s FROM strato_postgrest', r.kind, r.name);
    END IF;
    IF r.anon IS DISTINCT FROM r.wanted THEN
      IF r.anon IS NOT NULL THEN
        fixes := fixes || format('REVOKE ALL ON %s %s FROM strato_cirrus_anon', r.kind, r.name);
      END IF;
      IF r.wanted IS NOT NULL THEN
        fixes := fixes || format('GRANT SELECT ON TABLE %s TO strato_cirrus_anon', r.name);
      END IF;
    END IF;
    IF r.app IS DISTINCT FROM r.wanted THEN
      IF r.app IS NOT NULL THEN
        fixes := fixes || format('REVOKE ALL ON %s %s FROM strato_app', r.kind, r.name);
      END IF;
      IF r.wanted IS NOT NULL THEN
        fixes := fixes || format('GRANT SELECT ON TABLE %s TO strato_app', r.name);
      END IF;
    END IF;
  END LOOP;

  -- strato_cirrus_anon executes Slipstream's read-only computed relationships
  -- and the array-field helper jsonb_obj_to_array, strato_app the helper;
  -- neither holds another function, strato_postgrest none. New relationships
  -- receive their grant when Slipstream creates them.
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS name,
           CASE WHEN s.slipstream AND (s.relationship OR s.helper) THEN ARRAY['EXECUTE'] END AS anon_wanted,
           CASE WHEN s.slipstream AND s.helper THEN ARRAY['EXECUTE'] END AS app_wanted,
           acl.anon, acl.app, acl.postgrest
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      CROSS JOIN LATERAL (
        SELECT pg_get_userbyid(p.proowner) = 'strato_cirrus' AND l.lanname = 'sql'
                 AND p.pronargs = 1 AND NOT p.prosecdef AS slipstream,
               coalesce(p.provolatile = 's' AND p.proretset
                 AND (SELECT typnamespace FROM pg_type WHERE oid = p.proargtypes[0]) = n.oid
                 AND (SELECT typnamespace FROM pg_type WHERE oid = p.prorettype) = n.oid
                 AND btrim(p.prosrc, E' \n\r\t') LIKE 'SELECT v.*%', false) AS relationship,
               coalesce(p.provolatile = 'i' AND p.proname = 'jsonb_obj_to_array'
                 AND p.proargtypes[0] = 'jsonb'::regtype AND p.prorettype = 'jsonb'::regtype, false) AS helper) s
      CROSS JOIN LATERAL (
        SELECT array_agg(q.priv ORDER BY q.priv) FILTER (WHERE a.grantee = 'strato_cirrus_anon'::regrole) AS anon,
               array_agg(q.priv ORDER BY q.priv) FILTER (WHERE a.grantee = 'strato_app'::regrole) AS app,
               coalesce(bool_or(a.grantee = 'strato_postgrest'::regrole), false) AS postgrest
          FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          CROSS JOIN LATERAL (SELECT a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END AS priv) q) acl
     WHERE n.nspname = 'public'
  LOOP
    IF r.postgrest THEN
      fixes := fixes || format('REVOKE ALL ON ROUTINE %s FROM strato_postgrest', r.name);
    END IF;
    IF r.anon IS DISTINCT FROM r.anon_wanted THEN
      IF r.anon IS NOT NULL THEN
        fixes := fixes || format('REVOKE ALL ON ROUTINE %s FROM strato_cirrus_anon', r.name);
      END IF;
      IF r.anon_wanted IS NOT NULL THEN
        fixes := fixes || format('GRANT EXECUTE ON FUNCTION %s TO strato_cirrus_anon', r.name);
      END IF;
    END IF;
    IF r.app IS DISTINCT FROM r.app_wanted THEN
      IF r.app IS NOT NULL THEN
        fixes := fixes || format('REVOKE ALL ON ROUTINE %s FROM strato_app', r.name);
      END IF;
      IF r.app_wanted IS NOT NULL THEN
        fixes := fixes || format('GRANT EXECUTE ON FUNCTION %s TO strato_app', r.name);
      END IF;
    END IF;
  END LOOP;

  FOREACH stmt IN ARRAY fixes LOOP
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN undefined_table OR undefined_function THEN
      NULL; -- Slipstream dropped it since the scan above: nothing left to fix
    END;
  END LOOP;
END $refresh$;
ALTER DEFAULT PRIVILEGES FOR ROLE strato_cirrus IN SCHEMA public GRANT SELECT ON TABLES TO strato_app;
ALTER DEFAULT PRIVILEGES FOR ROLE strato_cirrus IN SCHEMA public GRANT SELECT ON TABLES TO strato_cirrus_anon;
COMMIT;
SQL
fi
if [ "${PG_HAS_APEX:-false}" = true ]; then
  prepare_db apex_prod strato_apex
  # Only what strato_apex still lacks is granted, for the same reason as above.
  retry_psql -d "$eth_db" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(617074, hashtext(current_database()));
SELECT 'GRANT USAGE ON SCHEMA public TO strato_apex'
 WHERE NOT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                    WHERE n.nspname = 'public' AND a.grantee = 'strato_apex'::regrole AND a.privilege_type = 'USAGE')
\gexec
SELECT 'GRANT SELECT ON TABLE ' || string_agg(format('%I.%I', n.nspname, c.relname), ', ') || ' TO strato_apex'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
   AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) a
                    WHERE a.grantee = 'strato_apex'::regrole AND a.privilege_type = 'SELECT')
HAVING count(*) > 0
\gexec
ALTER DEFAULT PRIVILEGES FOR ROLE strato_eth IN SCHEMA public GRANT SELECT ON TABLES TO strato_apex;
COMMIT;
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
