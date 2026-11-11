-- Run as the runtime role against a disposable database it owns:
-- psql -X -v ON_ERROR_STOP=1 -f postgres-permissions.sql <connection options>
-- All test objects and changes are rolled back, including on a failed check.
BEGIN;
CREATE SCHEMA strato_permission_test;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA strato_permission_test;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA strato_permission_test;
CREATE TABLE strato_permission_test.entries (value integer);
CREATE FUNCTION strato_permission_test.increment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.value := NEW.value + 1; RETURN NEW; END;
$$;
CREATE TRIGGER increment BEFORE INSERT ON strato_permission_test.entries
  FOR EACH ROW EXECUTE FUNCTION strato_permission_test.increment();
INSERT INTO strato_permission_test.entries VALUES (1);
CREATE VIEW strato_permission_test.entry_view AS SELECT * FROM strato_permission_test.entries;
DO $$
DECLARE statement text;
BEGIN
  IF current_user <> 'strato'
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname <> 'strato')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolsuper AND (rolcanlogin OR rolname <> 'strato_admin'))
     OR pg_has_role(current_user, 'strato_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'Unexpected application or bootstrap role privileges';
  END IF;
  IF (SELECT value FROM strato_permission_test.entry_view) <> 2 THEN
    RAISE EXCEPTION 'Normal indexing operations failed';
  END IF;
  FOREACH statement IN ARRAY ARRAY[
    'COPY strato_permission_test.entries FROM PROGRAM ''false''',
    'COPY strato_permission_test.entries TO PROGRAM ''false''',
    'COPY strato_permission_test.entries FROM ''/dev/null''',
    'COPY strato_permission_test.entries TO ''/dev/null''',
    'SELECT pg_read_file(''/etc/hostname'')',
    'CREATE FUNCTION strato_permission_test.unsafe() RETURNS void AS ''/tmp/missing.so'', ''unsafe'' LANGUAGE c',
    'CREATE ROLE strato_permission_test_admin SUPERUSER',
    format('ALTER ROLE %I SUPERUSER', current_user),
    format('GRANT pg_execute_server_program TO %I', current_user),
    format('GRANT pg_read_server_files TO %I', current_user),
    format('GRANT pg_write_server_files TO %I', current_user),
    'ALTER ROLE strato_admin LOGIN',
    format('GRANT strato_admin TO %I', current_user),
    'SET ROLE strato_admin'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Unsafe privilege allowed: %', statement;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Blocked: %', statement;
    END;
  END LOOP;
END;
$$;
ROLLBACK;
