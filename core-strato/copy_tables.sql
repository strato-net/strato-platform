DROP FUNCTION IF EXISTS check_all_sizes();
DROP TYPE IF EXISTS holder;

CREATE TYPE holder as (tname text, count int);

CREATE FUNCTION check_all_sizes() RETURNS SETOF holder as $$
DECLARE
  table_name text;
  c int;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename asc
  LOOP
    EXECUTE 'SELECT count(*) FROM ' || quote_ident(table_name) INTO c;
    RETURN NEXT (table_name, c);
  END LOOP;
  RETURN;
END

$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION backup_all() RETURNS void AS $$
DECLARE
  table_name text;
  backup_table text;
BEGIN
  /* Create a copy of all tables */
	FOR table_name in SELECT tablename FROM pg_catalog.pg_tables where schemaname = 'public' and tablename not like '%backup%'
  LOOP
    backup_table := table_name||'_backup_'||now();
    EXECUTE 'CREATE TABLE ' || quote_ident(backup_table) || ' AS TABLE ' || quote_ident(table_name);
  END LOOP;

  /* Reset the tables that don't handle restarts well */
  EXECUTE 'TRUNCATE account_info_ref cascade';
  EXECUTE 'TRUNCATE address_state_ref cascade';
  EXECUTE 'TRUNCATE chain_info_ref cascade';
  EXECUTE 'TRUNCATE chain_member_ref cascade';
  EXECUTE 'TRUNCATE chain_metadata_ref cascade';
  EXECUTE 'TRUNCATE chain_signature_ref cascade';
  EXECUTE 'TRUNCATE code_info_ref cascade';
  EXECUTE 'TRUNCATE storage cascade';

  /* Clean up after p2p's exit */
  EXECUTE 'UPDATE p_peer SET active_state = 0';

	RETURN;
END

$$ LANGUAGE plpgsql;

SELECT backup_all();
