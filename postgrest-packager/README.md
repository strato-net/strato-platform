# postgrest-packager

A packager for `postgrest`

## Schema reloads

slipstream announces new Cirrus tables, views and functions with
`NOTIFY pgrst, 'reload schema'`. NOTIFY does not cross physical replication,
so a PostgREST pointed at a read replica would never learn about them.
`doit.sh` therefore fingerprints the exposed schema every
`POSTGREST_SCHEMA_RELOAD_SECONDS` (default 30) and sends PostgREST `SIGUSR1`,
its reload signal, only when the fingerprint changes. Set it to `0` to
disable the watcher.

## Statement timeout

Every request runs `public.postgrest_pre_request()` first (PostgREST's
`db-pre-request`), which sets `statement_timeout` for that transaction to
`POSTGREST_STATEMENT_TIMEOUT` (default `60s`, matching the proxy timeouts in
front of the node). `doit.sh` creates the function at startup. The limit
applies to API queries only; slipstream's sessions are unaffected. `0`
disables it.
