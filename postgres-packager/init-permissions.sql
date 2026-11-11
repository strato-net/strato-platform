-- Preserve PostgreSQL's bootstrap administrator for trusted extension installs.
-- Applications connect as strato with the same password, without its powers.
CREATE ROLE strato LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('ALTER ROLE strato PASSWORD %L', rolpassword)
  FROM pg_authid WHERE rolname = 'strato_admin' \gexec
ALTER ROLE strato_admin NOLOGIN PASSWORD NULL;
ALTER DATABASE eth OWNER TO strato;
