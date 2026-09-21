# Node Snapshot Dev Loop - Interface Design

## Overview

Development should not require every engineer to sync a STRATO node from genesis. A snapshot is a cold, portable copy of a fully synced node's persisted state. Engineers restore that copy into a local node directory, start from the snapshot tip, and then use fast app patching (`make app` plus `strato-patch-app`) for normal iteration.

This document defines the interface for snapshot production, artifact format, restore behavior, and safety gates.

## Goals

- Restore a usable development node in minutes, not hours.
- Keep full-sync testing in CI, not in the default local loop.
- Make snapshots reproducible and safe to publish.
- Avoid shipping user OAuth tokens, SSL private keys, logs, or host-specific node config.
- Keep the interface scriptable for Jenkins, local shell usage, and `strato-up --snapshot`.

## Non-goals

- Hot snapshots of a running node.
- Cross-network conversion.
- Database schema migrations across incompatible STRATO versions.
- Snapshots for production backups or disaster recovery.

## CLI

The command:

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

- Fail if the node is not currently synced before shutdown. With
  `--wait-timeout`, poll (every `--wait-interval` seconds) until the node and
  layer tips converge instead of failing immediately.
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
  --source s3://strato-snapshots/helium/v2/latest.tar.zst \
  --network helium \
  [--force]
```

Required behavior:

- Refuse to restore into a running node.
- Refuse to restore if `<node-dir>` contains state unless `--force` is passed.
- Ensure `<node-dir>` has a generated local config (`strato-setup` or equivalent).
- Validate the snapshot network against the requested network.
- Restore state payload.
- Preserve local host-specific config, including the node's own Postgres
  password. The `eth` and `cirrus` databases are loaded from the snapshot's
  dumps into the node's own Postgres cluster; no credentials are imported.
- Normalize `localhost` SQL/Cirrus hosts in `ethconf.yaml` to `127.0.0.1`.
- Remove the stale `.strato.pid`.
- Start the node only when `--start` is passed; default is restore-only.

### `pull`

Download a published snapshot into the local download cache without restoring
it, so that a later `restore` (or `strato-up --snapshot`) of the same snapshot
skips the download.

```bash
strato-snapshot pull [<node-dir>] \
  [--network helium] \
  [--snapshot[=<timestamp>] | --source <s3-uri>]
```

Required behavior:

- Never touch a node directory; `pull` is safe to run while the node is serving.
- Default to the `latest` alias for the network when no selection is given.
- When `--network` is not passed, take it from `<node-dir>`'s `ethconf.yaml`,
  else from the default node recorded by `strato-setup`
  (`~/.strato/default-node`). Refuse a `--network` that contradicts
  `<node-dir>`'s configured network.
- Download into the same persistent cache `restore` reads
  (`./.snapshot-downloads`, or `STRATO_SNAPSHOT_DOWNLOAD_DIR`), verify against
  the published `.sha256`, and reuse an already cached copy whose checksum
  still matches.
- Refuse a local `--source`: there is nothing to pull.
- Print the cached archive path on stdout.

### `inspect`

Print metadata without restoring.

```bash
strato-snapshot inspect ./snapshots/helium-latest.tar.zst
```

Output (one `key: value` per line):

- `network`
- `createdAt`
- `stratoVersion`
- `isSynced`, `nodeBestBlock`, `sequencedBestBlock`, `worldBestBlock`,
  `apiIndexerTip`, `cirrusTip` (from the manifest's `block` object)
- `payload` (comma-separated)

### `publish`

Publish an already-created and smoke-tested artifact.

```bash
strato-snapshot publish ./snapshots/helium-2026-04-24.tar.zst \
  --destination s3://strato-snapshots/helium/v2/ \
  --alias latest
```

Publishing should be atomic: upload the versioned artifact first, upload its checksum second, then update `latest` only after both are available.

## Artifact Contract

Snapshot artifacts are `tar.zst` archives with this root layout:

```text
SNAPSHOT.json
payload/
  ethereumH/
  postgres-dumps/
    eth.dump               # pg_dump custom format (-Fc)
    cirrus.dump
  redis/
  jlog/
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
- `secrets/postgres_password`
- the `oauth` database (node key, user keys)
- the raw `postgres/` data directory
- macOS AppleDouble metadata files (`._*`)

`ethconf.yaml` is intentionally excluded because it contains host-specific values and embeds the local Postgres password. Postgres is captured as logical dumps of the public blockchain databases (`eth`, `cirrus`) rather than the raw data directory, so no node-specific password or local-only `oauth` data ever rides along. Restore preserves the target node's generated config and credentials and only rewrites `localhost` database hosts to `127.0.0.1`.

## `SNAPSHOT.json`

Example:

```json
{
  "schemaVersion": 1,
  "network": "helium",
  "createdAt": "2026-04-24T14:30:00Z",
  "createdBy": "ubuntu@testsync1",
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
    "postgres-dumps/eth.dump",
    "postgres-dumps/cirrus.dump",
    "redis",
    "jlog"
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

`createdBy` is `<user>@<hostname>` of the machine that ran `create`.
`stratoVersion` is the tag of the `strato` service image in the source node's
`docker-compose.yml` when that file defines one, else `"unknown"` (the
locally generated compose runs STRATO under `convoke` rather than as a
service, so snapshots from such nodes record `"unknown"` and restore's
major-version check is skipped for them). `payload` names the top-level
entries under `payload/`; `prometheus` is appended when `--include-prometheus`
was passed.

## State Model

Snapshot state is valid only when captured from a quiesced node.

The relevant writable stores are:

- `.ethereumH/*`: LevelDB-backed chain/state data, excluding `ethconf.yaml`.
- `postgres/`: Postgres data directory. Only the `eth` and `cirrus` databases are captured (as dumps); the local-only `oauth` database is not.
- `redis/`: Redis append-only data for block/sync metadata.
- `jlog/`: embedded jlog streaming state (topic segments and per-subscriber checkpoints).
- `prometheus/`: optional metrics state; excluded by default because it is not needed for dev restore.

The snapshot is network-scoped. A `helium` snapshot must never restore into an `upquark` node directory.

## Create Safety Gate

`strato-snapshot create` must pass these gates before archiving.

### 1. App-level sync

Before shutdown:

```bash
curl -sf http://127.0.0.1:3000/eth/v1.2/metadata | jq -e '.isSynced == true'
```

Also capture the block heights for `SNAPSHOT.json`. The metadata endpoint
does not expose them, so `nodeBestBlock` and `sequencedBestBlock` come from
apex `/status` (`lastBlock.number`, `pbftData.sequence_number`; default
`http://apex:3009/status`, override with `--status-url`), and `worldBestBlock`
from metadata when present.

When `--strict-layers` is passed, also require API-indexer and Cirrus to be at
or ahead of the node tip within the configured lag. The default API-indexer tip
probe is `/eth/v1.2/block/last/1`; Cirrus should use an explicit
`--cirrus-tip-url` when CI has one, otherwise the CLI falls back to a conservative
Postgres probe against the `cirrus` database's `storage` table.

### 2. Redis AOF compaction, then cold shutdown

Before stopping anything, ask Redis to compact its append-only file so the
snapshot carries the dataset rather than its write history (best effort,
bounded wait):

```bash
docker exec <redis-container> redis-cli BGREWRITEAOF
# poll INFO persistence until aof_rewrite_in_progress:0 and aof_rewrite_scheduled:0
```

Then stop the node and Compose stack:

```bash
strato-down <node-dir> || true
cd <node-dir>
docker compose -p strato down --remove-orphans
```

After the stop, `strato-snapshot create` waits up to ~10 seconds for any local
processes that still hold files open under `.ethereumH`, `postgres`, `redis`,
or `jlog` to exit on their own, and refuses to archive if they remain. It does
not signal them itself (Docker Desktop's own file-sharing handles are ignored).

### 3. No running containers

```bash
test -z "$(docker compose -p strato ps -q)"
```

### 4. No open state files

```bash
! lsof +D "$PWD/postgres" >/dev/null 2>&1
! lsof +D "$PWD/redis" >/dev/null 2>&1
! lsof +D "$PWD/jlog" >/dev/null 2>&1
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
# Stage the payload, then archive the staging dir:
staging=$(mktemp -d)
mkdir -p "$staging/payload"/{ethereumH,redis,jlog,postgres-dumps}
tar -C .ethereumH --exclude=./ethconf.yaml --exclude='./*/LOG' --exclude='./*/LOG.old' -cf - . \
  | tar -C "$staging/payload/ethereumH" -xpf -    # LevelDB activity logs carry no state
tar -C redis -cf - . | tar -C "$staging/payload/redis" -xpf -
tar -C jlog  -cf - . | tar -C "$staging/payload/jlog"  -xpf -
chmod -R a+rwX "$staging/payload/jlog"      # usable by any uid after restore
# eth + cirrus as pg_dump custom-format dumps, via a throwaway postgres
# container on the stopped data dir:
pg_dump -Fc --no-owner --no-privileges eth    > "$staging/payload/postgres-dumps/eth.dump"
pg_dump -Fc --no-owner --no-privileges cirrus > "$staging/payload/postgres-dumps/cirrus.dump"
# SNAPSHOT.json, then:
tar -C "$staging" -cf - . | zstd -T0 -o "$OUTPUT"
```

The implementation stages into a working directory exactly like this; the interface requirement is the artifact layout, not these exact commands.

## Restore Contract

Restore should be deterministic and conservative.

### Fetching the archive

For an `s3://` source the tool keeps a per-directory download cache
(`./.snapshot-downloads`). The archive's SHA-256 is computed from the download
stream and checked against the published `.sha256` before the file is renamed
from `<archive>.part` into place; the verified digest is recorded in
`<archive>.verified` with the file's size and mtime, so a later run reuses an
unchanged cached archive without re-reading it. Other archives of the same
network in the cache are pruned around a successful download (before it when
the object has a published sidecar, so the space is available). Archives of
other networks are kept.

### Preflight

Fail if:

- The node is running.
- Docker containers for the `strato` Compose project are running.
- The snapshot network does not match `--network`.
- The target directory has existing `postgres`, `redis`, `jlog`, `kafka`, or `.ethereumH` chain data beyond generated config and `--force` was not passed.
- The snapshot's `stratoVersion` has a different major version than the target's `strato` image tag (skipped when either is unknown; `--allow-version-drift` overrides).
- The payload has no `jlog/` directory, i.e. it is a pre-v2 (kafka-era) archive this build cannot use. `--snapshot` can never select one, but an explicit `--source` pointed at the frozen v1 line can, and it is refused before any target state is touched.

### Config handling

Restore must preserve host-specific generated config:

- `apiConfig`
- `networkConfig.httpPort`
- `urlConfig.nodeUrl`
- local Docker compose ports
- local SSL configuration
- local OAuth credentials

Restore must copy from the snapshot:

- persisted state directories (`.ethereumH` contents, `redis/`, `jlog/`)
- the `eth` and `cirrus` databases, loaded from the dumps

Restore must not import credentials. The target keeps its own
`secrets/postgres_password` and the matching password fields in
`ethconf.yaml`; the dumps are loaded into the target's own Postgres cluster
(initialized with that password first if the data dir is still empty), so the
restored databases are reachable with the credentials the node already has.

Restore must update the target `.ethereumH/ethconf.yaml` in exactly one way:

- `sqlConfig.host` and `cirrusConfig.host` when set to `localhost` are
  rewritten to `127.0.0.1`, so host processes connect over the same address
  family as the IPv4-only Docker port bindings.

### Database load

The `eth` and `cirrus` dumps are loaded by a throwaway `postgres:14.18`
container started on the node's own data directory with the extracted dumps
bind-mounted read-only at `/dumps` (no copy into the container), running as the
node's postgres uid with durability relaxed for the bulk load. Each database is
dropped, recreated empty and restored with `pg_restore -j <cpus>`; index
rebuilding dominates the time.

### Restore log

`restore` reports seven numbered steps on stderr (plan, fetch, extract, checks,
replace state, load databases, finalize) with sizes, file counts and per-step
timings, so an operator can see what the tool is doing at any moment and where
the time goes.

### Payload replacement

The restore process removes and replaces only state:

```text
.ethereumH/* except ethconf.yaml
redis/
jlog/
kafka/                       # removed if present (leftover from a pre-jlog build); never written
prometheus/ if present and requested
eth and cirrus databases     # dropped and reloaded from the dumps
```

It must not overwrite:

```text
docker-compose.yml
.env
.ethereumH/ethconf.yaml      # except the localhost host rewrite above
postgres/                    # the cluster itself, incl. its oauth database
secrets/postgres_password
secrets/oauth_credentials.yaml
secrets/oauth_token
secrets/ssl/
logs/
```

## Smoke Test

`strato-snapshot smoke-test` (also run by `create` unless `--skip-smoke-test`):

1. Restore into an empty temporary node directory (`--node-dir` to choose one).
2. Start the node with `strato-up`.
3. Wait (up to `--timeout`, default 600s) for the local STRATO API metadata
   endpoint to return JSON containing the `isSynced` field.
4. Stop the temporary node.

This proves the restored state starts and serves the API; it does not compare
block heights. The synctest pipeline therefore skips the built-in smoke test
and runs its own restore check before publishing: it restores the created
archive with `strato-up --snapshot-source=<file>`, waits for the node to come
up, and requires apex `/status` `lastBlock.number` to be within 100 blocks of
the height the snapshot was taken at -- proving it resumed from the snapshot
rather than from genesis. Only then is the archive published and `latest`
moved.

## Storage Layout

Recommended remote layout. Each artifact has a sidecar checksum named
`<artifact>.sha256` (the full filename plus `.sha256`, so
`sha256sum -c <artifact>.sha256` works in place):

```text
s3://strato-snapshots/
  helium/
    latest.tar.zst                          # v1 (kafka-era): frozen, no longer
    latest.tar.zst.sha256                   # published to
    helium-20260424-143000Z.tar.zst
    helium-20260424-143000Z.tar.zst.sha256
    v2/                                     # jlog streaming
      latest.tar.zst
      latest.tar.zst.sha256
      helium-20260828-143000Z.tar.zst
      helium-20260828-143000Z.tar.zst.sha256
  upquark/
    latest.tar.zst
    latest.tar.zst.sha256
    v2/
      ...
```

Timestamped artifacts are immutable. `latest` is a movable alias updated only after smoke test success.

Snapshots are scoped by **snapshot version** (`SNAPSHOT_VERSION` in
`bin/strato-snapshot`): a build publishes to, and resolves `--snapshot` from,
only `<network>/<version>/`. The version is bumped whenever the captured state
stops being readable by the previous version's nodes, so those nodes keep their
own `latest` instead of having it overwritten with state they cannot read. v1
is the bare `<network>/` root because tool versions predating the constant have
that location hardcoded; v2 is the first versioned line and carries jlog
streaming state in place of kafka.

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
  --source s3://strato-snapshots/helium/v2/latest.tar.zst \
  --network helium

strato-up mynode
```

To restart an existing node from the latest snapshot with as little downtime
as possible, pull the snapshot while the node is still serving, then replace
the node directory. The restore reuses the pulled archive instead of
downloading it while the node is down:

```bash
strato-snapshot pull mynode
strato-down mynode && rm -rf mynode && strato-up mynode --network=helium --snapshot
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
- **Postgres password mismatch:** backend, apex, or postgrest cannot connect. Avoided by design: restore never imports the source node's password; the dumps are loaded into the target's own cluster, so the target's existing `secrets/postgres_password` and `ethconf.yaml` fields stay correct.
- **Localhost database host mismatch:** host processes try `::1` while Docker
  exposes Postgres only on `127.0.0.1`. Fix by normalizing local SQL and Cirrus
  hosts during restore.
- **Network mismatch:** node may start with invalid state. Fix by refusing restore when snapshot network differs from requested network.
- **Version mismatch:** schema or state format may be incompatible. Fix by enforcing same major STRATO version unless explicitly overridden for testing.
- **Stale lock files:** LevelDB or pid lock errors on start. Fix by excluding `.strato.pid`, stopping all containers, and removing runtime-only locks during restore.
- **Partial sync / sequencer lag:** downloaded/world height can be ahead while local sequencer, VM, API-indexer, or Cirrus remain behind. Fix by refusing `create` until `isSynced=true` and all required layer tips converge.
- **False-positive startup:** `strato-up` can otherwise return before `convoke` proves it is alive. Fix by checking the `convoke` PID for an immediate startup exit and making snapshot smoke tests stop partially started nodes on failure.

## Decisions

- `prometheus/` is excluded by default; `--include-prometheus` opts in on both
  `create` and `restore`.
- `restore` is restore-only by default; `--start` starts the node afterwards.
- `strato-up --snapshot[=<timestamp>]` (and `--snapshot-source=<file-or-s3-uri>`)
  runs `strato-setup` and then `strato-snapshot restore` for a node directory
  that does not exist yet. For an existing directory the flag is ignored with a
  note, since that is a restart of an existing node, not a fresh one.
