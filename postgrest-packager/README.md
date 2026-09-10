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
