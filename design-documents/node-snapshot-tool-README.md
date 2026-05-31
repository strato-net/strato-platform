# STRATO Snapshot Tool README

`bin/strato-snapshot` creates and restores cold local STRATO node snapshots for
development. The intended local loop is: restore a synced snapshot, start the
node from that restored state, and avoid replaying the chain from genesis.

Snapshots are for development-loop acceleration. Do not treat these artifacts
as production backups or canonical recovery checkpoints.

## Prerequisites

- Docker running.
- Repository built or installed so `strato-setup`, `strato-up`, `strato-down`,
  and `convoke` are available.
- `python3`, `curl`, `tar`, and `lsof`.
- `aws` CLI only when reading from or publishing to S3.
- Enough disk for the archive and restored node data.

## Restore a Snapshot

Use a fresh node directory unless you intentionally want to replace state.

```bash
export SNAPSHOT_FILE=/tmp/helium-local-60999.tar
export NODE_DIR=../helium-local-60999-restore

bin/strato-snapshot inspect "$SNAPSHOT_FILE"

bin/strato-snapshot restore "$NODE_DIR" \
  --source "$SNAPSHOT_FILE" \
  --network helium

bin/strato-up "$NODE_DIR"
```

You can restore directly from S3 when your AWS profile has access:

```bash
bin/strato-snapshot restore "$NODE_DIR" \
  --source s3://strato-dev-snapshots-406773134706-us-east-1/helium-local-60999.tar \
  --network helium
```

Use `--force` only when replacing existing node state:

```bash
bin/strato-snapshot restore "$NODE_DIR" \
  --source "$SNAPSHOT_FILE" \
  --network helium \
  --force
```

Use `--start` to restore and start in one command:

```bash
bin/strato-snapshot restore "$NODE_DIR" \
  --source "$SNAPSHOT_FILE" \
  --network helium \
  --start
```

## Verify a Restored Node

Check the API metadata:

```bash
curl -sS http://127.0.0.1:3000/eth/v1.2/metadata
```

Check sync height:

```bash
cd "$NODE_DIR"
strato-barometer syncstats
```

Expected result after catch-up is `Sync Status: True` and API metadata with
`"isSynced": true`.

`strato-ps` currently reports the `convoke` supervisor PID, not every STRATO
child service. If `strato-ps` says `Convoke: Not running` but Docker containers
are healthy, also check metadata and host services before assuming the node is
down.

## Create a Snapshot

Start from a fully synced local node. By default, `create` requires metadata to
report `isSynced=true`, shuts writers down, checks for open state files, verifies
Postgres clean shutdown, writes `SNAPSHOT.json`, archives the payload, and runs
a restore smoke test.

```bash
bin/strato-snapshot create "$NODE_DIR" \
  --network helium \
  --output /tmp/helium-$(date -u +%Y%m%dT%H%M%SZ).tar
```

Useful create options:

```bash
--wait-timeout 3600       # poll until synced before snapshotting
--wait-interval 30        # poll interval for --wait-timeout
--strict-layers           # require API-indexer and Cirrus tip checks
--layer-lag 5             # allowed layer lag
--include-prometheus      # include prometheus/ state
--skip-smoke-test         # bypass restore smoke test
--smoke-node-dir <dir>    # choose the smoke-test restore directory
```

Supported archive extensions are `.tar`, `.tar.gz`, `.tgz`, `.tar.zst`, and
`.tzst`.

## Inspect a Snapshot

```bash
bin/strato-snapshot inspect /tmp/helium-local-60999.tar
```

Current inspect output includes network, creation time, STRATO version,
sync/block fields, API-indexer/Cirrus tips, and payload paths.

## Smoke Test

Run a restore/start/API metadata smoke test:

```bash
bin/strato-snapshot smoke-test \
  --source /tmp/helium-local-60999.tar \
  --network helium \
  --node-dir ../snapshot-smoke-test \
  --timeout 600
```

The current smoke test confirms the restored node starts and serves metadata
with an `isSynced` field. It does not scan all service logs or require the node
to be fully caught up by the end of the smoke test.

## Publish

Publish an already-created artifact to a local directory or S3 destination:

```bash
bin/strato-snapshot publish /tmp/helium-20260429T150000Z.tar \
  --destination s3://strato-dev-snapshots-406773134706-us-east-1/helium/ \
  --alias latest
```

`publish` uploads or copies the artifact, a `.sha256` checksum, and optional
alias files. Run smoke tests before publishing; `publish` does not enforce that
itself.

## Snapshot Contents

Included payload:

- `.ethereumH/` state, excluding `ethconf.yaml`
- `postgres/`
- `redis/`
- `kafka/`
- `secrets/postgres_password`
- `prometheus/` only when requested

Excluded payload:

- `logs/`
- `.strato.pid`
- `.ethereumH/ethconf.yaml`
- OAuth credentials and tokens
- SSL secrets
- macOS AppleDouble metadata files (`._*`)

Restore preserves the target node's generated host config, copies the snapshot
Postgres password, and rewrites `sqlConfig.password` and
`cirrusConfig.password` in `.ethereumH/ethconf.yaml` to match the restored
database. Restore also normalizes local `localhost` SQL and Cirrus hosts to
`127.0.0.1` so host processes connect to the IPv4-only Docker port bindings.

## More Detail

- Interface design: `design-documents/node-snapshot-dev-loop.md`
- Employee validation runbook:
  `design-documents/node-snapshot-employee-test-instructions.md`
- Fixture tests: `scripts/test-strato-snapshot.sh`
