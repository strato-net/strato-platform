#!/bin/sh
set -eu

export PGHOST="${postgres_host:-postgres}" PGPORT="${postgres_port:-5432}" PGUSER=postgres
export PGPASSWORD="${postgres_admin_password:?}"

until psql -X -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; do sleep 1; done

psql -X -v ON_ERROR_STOP=1 -d postgres -v db="${postgres_vault_wrapper_db:-oauth}" <<'SQL'
DO $role$
BEGIN
  BEGIN
    CREATE ROLE strato_vault LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  ALTER ROLE strato_vault LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'strato_vault')) THEN
    RAISE EXCEPTION 'strato_vault has role memberships';
  END IF;
END $role$;
\set vault_password `printf %s "$postgres_vault_password"`
ALTER ROLE strato_vault PASSWORD :'vault_password';
SELECT format('CREATE DATABASE %I OWNER strato_vault', :'db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO strato_vault', :'db')
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db')
\gexec
SQL

psql -X -v ON_ERROR_STOP=1 -d "${postgres_vault_wrapper_db:-oauth}" <<'SQL'
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO strato_vault;
SELECT format('ALTER %s %I.%I OWNER TO strato_vault',
              CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                             WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                             ELSE 'TABLE' END,
              n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'f', 'S')
   AND pg_get_userbyid(c.relowner) = 'postgres'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                     AND d.objid = c.oid AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
 ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END, c.oid
\gexec
SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO strato_vault',
              n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'postgres'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                     AND d.objid = p.oid AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
\gexec
ALTER DEFAULT PRIVILEGES FOR ROLE strato_vault REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
SQL

echo 'Vault PostgreSQL role and ownership are ready'
