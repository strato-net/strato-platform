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
front of the node). The limit applies to API queries only; slipstream's
sessions are unaffected. `0` disables it.

slipstream creates the function on the primary, because a PostgREST on an
API node reads a replica, which refuses DDL. The value reaches the function
as the `strato.postgrest_statement_timeout` setting on PostgREST's
connections (`options=` in `db-uri`), so each PostgREST keeps its own.
`doit.sh` waits up to a minute for the function and starts without the hook,
with a warning in the log, if it is still missing (an older slipstream).
