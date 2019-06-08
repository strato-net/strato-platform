CREATE OR REPLACE FUNCTION backup_all() RETURNS void AS $$
DECLARE
  table_name text;
  backup_table text;
BEGIN
	FOR table_name in SELECT tablename FROM pg_catalog.pg_tables where schemaname = 'public' and tablename not like '%backup%'
	    LOOP
		backup_table := table_name||'_backup_'||now();
		EXECUTE 'ALTER TABLE ' || quote_ident(table_name) || ' RENAME TO ' || quote_ident(backup_table) || ';';
		EXECUTE 'CREATE TABLE ' || quote_ident(table_name) || ' AS TABLE ' || quote_ident(backup_table) || ' WITH NO DATA';
	   END LOOP;

	RETURN;
END

$$ LANGUAGE plpgsql;

SELECT backup_all();
