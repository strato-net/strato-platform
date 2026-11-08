-- Run only by the one-shot pg-init service with the cluster administrator.
DO $roles$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'strato_eth', 'strato_cirrus', 'strato_apex', 'strato_app',
    'strato_postgrest', 'strato_auth', 'strato_vault', 'strato_history'
  ] LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', name);
    IF name <> 'strato_postgrest' AND EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = name)) THEN
      RAISE EXCEPTION 'runtime role % has memberships; remove them before startup', name;
    END IF;
  END LOOP;
END $roles$;

DO $anon$
BEGIN
  BEGIN
    CREATE ROLE strato_cirrus_anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  ALTER ROLE strato_cirrus_anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'strato_cirrus_anon')) THEN
    RAISE EXCEPTION 'strato_cirrus_anon has role memberships';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m
              JOIN pg_roles r ON r.oid = m.roleid
             WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'strato_postgrest')
               AND r.rolname <> 'strato_cirrus_anon') THEN
    RAISE EXCEPTION 'strato_postgrest has unexpected role memberships';
  END IF;
END $anon$;
ALTER ROLE strato_postgrest NOINHERIT;
GRANT strato_cirrus_anon TO strato_postgrest;

\set eth_password `cat /run/secrets/pg_eth_password`
\set cirrus_password `cat /run/secrets/pg_cirrus_password`
\set apex_password `cat /run/secrets/pg_apex_password`
\set app_password `cat /run/secrets/pg_app_password`
\set postgrest_password `cat /run/secrets/pg_postgrest_password`
\set auth_password `cat /run/secrets/pg_auth_password`
\set vault_password `cat /run/secrets/pg_vault_password`
\set history_password `cat /run/secrets/pg_history_password`

ALTER ROLE strato_eth PASSWORD :'eth_password';
ALTER ROLE strato_cirrus PASSWORD :'cirrus_password';
ALTER ROLE strato_apex PASSWORD :'apex_password';
ALTER ROLE strato_app PASSWORD :'app_password';
ALTER ROLE strato_postgrest PASSWORD :'postgrest_password';
ALTER ROLE strato_auth PASSWORD :'auth_password';
ALTER ROLE strato_vault PASSWORD :'vault_password';
ALTER ROLE strato_history PASSWORD :'history_password';
