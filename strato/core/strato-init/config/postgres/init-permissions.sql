-- Preserve PostgreSQL's bootstrap administrator for trusted extension installs.
-- Applications retain their existing username and password, without its powers.
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SELECT format('ALTER ROLE postgres PASSWORD %L', rolpassword)
  FROM pg_authid WHERE rolname = 'strato_admin' \gexec
ALTER ROLE strato_admin PASSWORD NULL;
ALTER DATABASE eth OWNER TO postgres;
