# Node Snapshot Dev Loop - Interface Design

## Overview

Development should not require every engineer to sync a STRATO node from genesis. A snapshot is a cold, portable copy of a fully synced node's persisted state. Engineers restore that copy into a local node directory, start from the snapshot tip, and then use fast app patching (`make app` plus `strato-patch-app`) for normal iteration.

This document defines the interface for snapshot production, artifact format, restore behavior, and safety gates.

## Goals

- Restore a usable development node in minutes, not hours.
- Keep full-sync testing in CI, not in the default local loop.
- Make snapshots reproducible and safe to publish.
- Avoid shipping user OAuth tokens, SSL private keys, logs, or host-specific node config.
- Keep the interface scriptable for Jenkins, local shell usage, and future `strato-up` integration.

## Non-goals

- Hot snapshots of a running node.
- Cross-network conversion.
- Database schema migrations across incompatible STRATO versions.
- Snapshots for production backups or disaster recovery.

## CLI

Add a new command:

```bash
strato-snapshot <command> [options]
```

### `create`

Create a cold snapshot from a local synced node directory.

```bash
strato-snapshot create <node-dir> \
  --network helium \
  --output ./snapshots/helium-2026-04-24.tar.zst \
  [--strict-layers] \
  [--include-prometheus]
```

Required behavior:

- Fail if the node is not currently synced before shutdown.
- Stop all STRATO writers.
- Verify containers and local processes no longer hold state files open.
- Verify Postgres reports a clean shutdown.
- Write `SNAPSHOT.json`.
- Archive only the approved payload paths.
- Run a restore smoke test unless `--skip-smoke-test` is explicitly passed.

### `restore`

Restore a snapshot into a local node directory.

```bash
strato-snapshot restore <node-dir> \
  --source s3://strato-snapshots/helium/latest.tar.zst \
  --network helium \
  [--force]
```

Required behavior:

- Refuse to restore into a running node.
- Refuse to restore if `<node-dir>` contains state unless `--force` is passed.
- Ensure `<node-dir>` has a generated local config (`strato-setup` or equivalent).
- Validate the snapshot network against the requested network.
- Restore state payload.
- Preserve local host-specific config.
- Copy the snapshot's local Postgres password and rewrite local config to match it.
- Remove stale pidfiles and runtime locks.
- Start the node only when `--start` is passed; default is restore-only.

### `inspect`

Print metadata without restoring.

```bash
strato-snapshot inspect ./snapshots/helium-latest.tar.zst
```

Output includes:

- network
- STRATO version and image tags
- captured block height
- captured sync status
- created timestamp
- payload paths
- compatibility constraints

### `publish`

Publish an already-created and smoke-tested artifact.

```bash
strato-snapshot publish ./snapshots/helium-2026-04-24.tar.zst \
  --destination s3://strato-snapshots/helium/ \
  --alias latest
```

Publishing should be atomic: upload the versioned artifact first, upload its checksum second, then update `latest` only after both are available.

## Artifact Contract

Snapshot artifacts are `tar.zst` archives with this root layout:

```text
SNAPSHOT.json
payload/
  ethereumH/
  postgres/
  redis/
  kafka/
  secrets/
    postgres_password
  prometheus/              # optional
```

The archive must not include:

- `logs/`
- `.strato.pid`
- Docker-generated temp files
- `secrets/oauth_token`
- `secrets/oauth_token.lock`
- `secrets/oauth_credentials.yaml`
- `secrets/ssl/`
- `.ethereumH/ethconf.yaml`
- macOS AppleDouble metadata files (`._*`)

`ethconf.yaml` is intentionally excluded because it contains host-specific values and embeds the local Postgres password. Restore preserves the target node's generated config, then rewrites the local database password fields and local database hosts to match the restored stores.

## `SNAPSHOT.json`

Example:

```json
{
  "schemaVersion": 1,
  "network": "helium",
  "createdAt": "2026-04-24T14:30:00Z",
  "createdBy": "jenkins:testsync1",
  "stratoVersion": "16.15-cda3022",
  "composeProject": "strato",
  "block": {
    "isSynced": true,
    "nodeBestBlock": 1234567,
    "sequencedBestBlock": 1234567,
    "worldBestBlock": 1234567,
    "apiIndexerTip": 1234567,
    "cirrusTip": 1234567
  },
  "images": {
    "strato": "strato:16.15-cda3022-...",
    "apex": "apex:16.15-cda3022-...",
    "postgrest": "postgrest:16.15-cda3022-...",
    "nginx": "nginx:16.15-cda3022-...",
    "appBackend": "app-backend:16.15-cda3022-...",
    "appUi": "app-ui:16.15-cda3022-..."
  },
  "payload": [
    "ethereumH",
    "postgres",
    "redis",
    "kafka",
    "secrets/postgres_password"
  ],
  "checksums": {
    "payloadSha256": "<sha256>"
  },
  "compatibility": {
    "requiresSameNetwork": true,
    "requiresSameMajorVersion": true,
    "allowPatchVersionDrift": true
  }
}
```

## State Model

Snapshot state is valid only when captured from a quiesced node.

The relevant writable stores are:

- `.ethereumH/*`: LevelDB-backed chain/state data, excluding `ethconf.yaml`.
- `postgres/`: Postgres data directory for `eth` and `cirrus`.
- `redis/`: Redis append-only data for block/sync metadata.
- `kafka/`: Kafka logs used by local services.
- `prometheus/`: optional metrics state; excluded by default because it is not needed for dev restore.

The snapshot is network-scoped. A `helium` snapshot must never restore into an `upquark` node directory.

## Create Safety Gate

`strato-snapshot create` must pass these gates before archiving.

### 1. App-level sync

Before shutdown:

```bash
curl -sf http://127.0.0.1:3000/eth/v1.2/metadata | jq -e '.isSynced == true'
```

Also capture `nodeBestBlock`, `sequencedBestBlock`, and `worldBestBlock` for `SNAPSHOT.json`.

When `--strict-layers` is passed, also require API-indexer and Cirrus to be at
or ahead of the node tip within the configured lag. The default API-indexer tip
probe is `/eth/v1.2/block/last/1`; Cirrus should use an explicit
`--cirrus-tip-url` when CI has one, otherwise the CLI falls back to a conservative
Postgres probe against the `cirrus` database's `storage` table.

### 2. Cold shutdown

Stop the node and Compose stack:

```bash
strato-down <node-dir> || true
cd <node-dir>
docker compose -p strato down --remove-orphans
```

If `.strato.pid` is stale, `strato-snapshot create` also checks for local processes
with open files under `.ethereumH`, `postgres`, `redis`, or `kafka`, sends them
`TERM`, and refuses to archive if they remain alive.

### 3. No running containers

```bash
test -z "$(docker compose -p strato ps -q)"
```

### 4. No open state files

```bash
! lsof +D "$PWD/postgres" >/dev/null 2>&1
! lsof +D "$PWD/redis" >/dev/null 2>&1
! lsof +D "$PWD/kafka" >/dev/null 2>&1
! lsof +D "$PWD/.ethereumH" >/dev/null 2>&1
```

### 5. Clean Postgres shutdown

Run `pg_controldata` against the stopped data directory and require `Database cluster state: shut down`.

```bash
docker run --rm \
  -v "$PWD/postgres:/var/lib/postgresql/data:ro" \
  postgres:14.18 \
  pg_controldata /var/lib/postgresql/data \
  | grep "Database cluster state:.*shut down"
```

### 6. Archive

Archive only the payload contract:

```bash
tar --zstd -cpf "$OUTPUT" \
  SNAPSHOT.json \
  --transform 's|^\\.ethereumH|payload/ethereumH|' .ethereumH \
  --transform 's|^postgres|payload/postgres|' postgres \
  --transform 's|^redis|payload/redis|' redis \
  --transform 's|^kafka|payload/kafka|' kafka \
  --transform 's|^secrets/postgres_password|payload/secrets/postgres_password|' secrets/postgres_password \
  --exclude='.ethereumH/ethconf.yaml' \
  --exclude='logs' \
  --exclude='.strato.pid' \
  --exclude='secrets/oauth_*' \
  --exclude='secrets/ssl'
```

Implementation can use a staging directory instead of `tar --transform`; the interface requirement is the artifact layout, not this exact command.

## Restore Contract

Restore should be deterministic and conservative.

### Preflight

Fail if:

- The node is running.
- Docker containers for the `strato` Compose project are running.
- The snapshot network does not match `--network`.
- The target directory has existing `postgres`, `redis`, `kafka`, or `.ethereumH` chain data beyond generated config and `--force` was not passed.
- The snapshot requires a different incompatible STRATO major version.

### Config handling

Restore must preserve host-specific generated config:

- `apiConfig`
- `networkConfig.httpPort`
- `urlConfig.nodeUrl`
- local Docker compose ports
- local SSL configuration
- local OAuth credentials

Restore must copy from the snapshot:

- `payload/secrets/postgres_password`
- persisted state directories

Restore must update the target `.ethereumH/ethconf.yaml`:

- `sqlConfig.password`
- `cirrusConfig.password`
- `sqlConfig.host` and `cirrusConfig.host` when they point at local Docker
  database bindings

The password fields must match `secrets/postgres_password`, because the restored Postgres data directory was initialized with that password. Localhost database hosts should resolve to the same address family as the generated Docker port bindings.

### Payload replacement

The restore process should remove and replace only state directories:

```text
.ethereumH/* except ethconf.yaml
postgres/
redis/
kafka/
prometheus/ if present and requested
secrets/postgres_password
```

It must not overwrite:

```text
docker-compose.yml
.env
secrets/oauth_credentials.yaml
secrets/oauth_token
secrets/ssl/
logs/
```

## Smoke Test

Every published snapshot must pass a restore smoke test:

1. Restore into an empty temporary node directory.
2. Start the node.
3. Wait for the local STRATO API metadata endpoint to return valid JSON.
4. Require the metadata response to include sync fields.
5. Require either `isSynced=true` or a nonzero `nodeBestBlock` at least equal to the snapshot's captured `nodeBestBlock`.
6. Stop the temporary node.

The smoke test should not publish if Postgres enters crash recovery failures, Redis cannot load append-only data, or LevelDB lock/corruption errors appear in logs.

## Storage Layout

Recommended remote layout. Each artifact has a sidecar checksum named
`<artifact>.sha256` (the full filename plus `.sha256`, so
`sha256sum -c <artifact>.sha256` works in place):

```text
s3://strato-snapshots/
  helium/
    latest.tar.zst
    latest.tar.zst.sha256
    helium-20260424-143000Z.tar.zst
    helium-20260424-143000Z.tar.zst.sha256
  upquark/
    latest.tar.zst
    latest.tar.zst.sha256
```

Versioned artifacts are immutable. `latest` is a movable alias updated only after smoke test success.

## CI Integration

Recommended Jenkins flow:

1. Start a clean node on the target network.
2. Wait for full sync using the existing sync test helper.
3. Run `strato-snapshot create`.
4. Restore the artifact into a temporary node directory.
5. Run the smoke test.
6. Publish the artifact and update `latest`.
7. Continue running the existing full sync job as a regression metric.

This keeps full sync measured in CI while making local development restore from a known-good state.

## Developer Flow

Typical local use (start directly from the latest published snapshot):

```bash
strato-up mynode --network=helium --snapshot
```

Or restore explicitly, then start:

```bash
strato-snapshot restore mynode \
  --source s3://strato-snapshots/helium/latest.tar.zst \
  --network helium

strato-up mynode
```

After that, app iteration should use the existing patch flow:

```bash
make app
strato-down mynode
strato-patch-app mynode app-backend:<tag> app-ui:<tag>
```

For pure App UI/backend work, the preferred loop remains dev mode against a shared synced node via `NODE_URL`; snapshots are for work that actually requires a local STRATO node.

## Failure Modes

- **Snapshot was taken while writers were active:** smoke test fails or restored services enter crash recovery. Fix by requiring the cold shutdown gates.
- **Postgres password mismatch:** backend, apex, or postgrest cannot connect. Fix by copying `secrets/postgres_password` from the snapshot and rewriting `ethconf.yaml` password fields.
- **Localhost database host mismatch:** host processes try `::1` while Docker
  exposes Postgres only on `127.0.0.1`. Fix by normalizing local SQL and Cirrus
  hosts during restore.
- **Network mismatch:** node may start with invalid state. Fix by refusing restore when snapshot network differs from requested network.
- **Version mismatch:** schema or state format may be incompatible. Fix by enforcing same major STRATO version unless explicitly overridden for testing.
- **Stale lock files:** LevelDB or pid lock errors on start. Fix by excluding `.strato.pid`, stopping all containers, and removing runtime-only locks during restore.
- **Partial sync / sequencer lag:** downloaded/world height can be ahead while local sequencer, VM, API-indexer, or Cirrus remain behind. Fix by refusing `create` until `isSynced=true` and all required layer tips converge.
- **False-positive startup:** `strato-up` can otherwise return before `convoke` proves it is alive. Fix by checking the `convoke` PID for an immediate startup exit and making snapshot smoke tests stop partially started nodes on failure.

## Open Decisions

- Whether `prometheus/` is ever useful enough to include by default.
- Whether restore should start the node by default or remain restore-only.
- Whether `strato-up` should call `strato-snapshot restore` automatically when a node directory is empty and `--from-snapshot latest` is provided.
