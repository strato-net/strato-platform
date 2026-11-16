# Moving a node's Postgres to the managed cluster

Phase 2 of the tiered deployment. Each node's `eth` and `cirrus` databases
move from the `postgres` container in its directory to the shared Aurora
PostgreSQL cluster (the ha-infra repo's `data-plane`). Afterwards the core's indexer and
slipstream write the cluster's writer endpoint, and PostgREST (later the API
tier and the app backend) read the reader endpoint.

## What changes on the node

- `strato-setup` treats any `--pghost` other than `localhost` as an external
  cluster: no `postgres` container is generated, the containers that used to
  reach `postgres:5432` (PostgREST, apex, app-backend, local-auth) get the
  cluster's hostname instead, and `--pgReaderHost` sends PostgREST and the
  app backend to the reader endpoint.
- `strato-setup --regenerate` rewrites `ethconf.yaml`, `docker-compose.yml`
  and `commands.txt` for an existing directory without touching the chain
  state, genesis or secrets (an explicit `--password` does replace the stored
  Postgres password). It refuses to change the network identity, which is the
  one thing a forgotten `--network` flag would silently alter.

## Runbook

Per node, inside a maintenance window. The chain keeps running on the other
validators; this node is down for the duration of the dump and restore.

1. Deploy the cluster once per environment (the ha-infra repo's `data-plane`), allowing the
   node's security group or CIDR on port 5432. Note the writer and reader
   endpoints and the secret name.
2. Rehearse on a testnet node first. Time the dump and restore: a from-genesis
   `cirrus` is the bulk of it.
3. `strato-down <node-dir>`.
4. Run the migration, passing the node's original setup flags after `--`:
   ```sh
   strato-pg-migrate <node-dir> --writer <writer-endpoint> --reader <reader-endpoint> \
     --password-file <file with the cluster password> -- --network=helium <other original flags>
   ```
   It dumps both databases from the node's container, restores them into the
   cluster, verifies that the indexer and Cirrus progress rows, the block tip,
   the transaction count and the number of Cirrus tables match, stops the
   local container, and re-generates the node's configuration.
5. `strato-up <node-dir>`. Watch `indexer_progress` and `cirrus_progress`
   advance on the cluster, and PostgREST answer through the reader endpoint.
   The local Kafka still holds the last seven days of `indexevents` and
   `vmevents`, so blocks produced while the node was down are indexed on
   catch-up as usual.

## Rollback

The container's data directory is untouched. `strato-down`, then
`strato-setup <node-dir> --regenerate --pghost=localhost --password=<old
password> <original flags>`, then `strato-up`. Blocks indexed into the
cluster in the meantime are re-indexed into the container from Kafka on the
way back up; every index write is idempotent.

## Notes

- Aurora's master user is `rds_superuser`, not a superuser. The node needs
  nothing beyond that: it creates databases and tables, functions in
  PL/pgSQL, triggers and indexes, and uses no extensions.
- libpq negotiates TLS by default (`sslmode=prefer`), so the Haskell
  processes use TLS to the cluster without configuration. `rds.force_ssl`
  is left off in the parameter group so the Node.js clients (apex, app
  backend) keep working unchanged; turn it on once they pass `ssl` options.
- `bin/strato-snapshot` still dumps from the local container. Snapshots of a
  migrated node need a cluster snapshot plus the host's LevelDB, Redis and
  Kafka; that tooling is a follow-up.
- Replica lag is what makes `resolve=true` fragile on the reader endpoint;
  the API tier keeps reading the writer until Phase 4 replaces the poll with
  the results stream.
