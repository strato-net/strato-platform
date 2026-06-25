# Node Snapshot Employee Test Instructions

These instructions are for validating the experimental STRATO node snapshot
restore path and confirming that a restored node can ingest from the snapshot
height instead of syncing from genesis.

This artifact is for development-loop testing. Do not treat it as a production
backup or canonical network checkpoint.

## Test Goals

- Restore a pre-synced STRATO node snapshot into a fresh local node directory.
- Start STRATO from the restored state.
- Confirm the restored node exposes metadata, keeps its stores readable, and
  ingests new blocks from the snapshot height.
- Capture enough logs and state to diagnose failures.

## Requirements

- macOS or Linux with Docker running.
- `aws` CLI only if downloading directly from S3.
- `curl`, `jq`, and `shasum`.
- Enough free disk space for the archive and restored node directory.
- A clean checkout of the branch under test:

```bash
export SNAPSHOT_BRANCH=develop
git fetch origin "$SNAPSHOT_BRANCH"
git checkout -B "$SNAPSHOT_BRANCH" "origin/$SNAPSHOT_BRANCH"
```

All commands below assume they are run from the repository root.

## Snapshot Source

Set these values from the snapshot handoff:

```bash
export SNAPSHOT_NETWORK="network-from-handoff"
export SNAPSHOT_SOURCE="s3-uri-or-local-snapshot-file"
export SNAPSHOT_FILE=/tmp/strato-node-snapshot.tar.zst
```

If you have S3 access or a local file, use `SNAPSHOT_SOURCE` directly when
restoring. If you only have a presigned URL, download the artifact first:

```bash
curl -L "$PRESIGNED_SNAPSHOT_URL" -o "$SNAPSHOT_FILE"
export SNAPSHOT_SOURCE="$SNAPSHOT_FILE"
```

If the snapshot handoff includes a checksum, verify it before continuing:

```bash
export SNAPSHOT_SHA256="checksum-from-handoff"
test "$(shasum -a 256 "$SNAPSHOT_FILE" | awk '{print $1}')" = "$SNAPSHOT_SHA256"
```

## Restore

Use a new node directory so the test cannot overwrite an existing node:

```bash
export NODE_DIR="../snapshot-ingest-test-$(date +%Y%m%d%H%M%S)"
mkdir -p "$NODE_DIR"
```

Inspect the snapshot before restore and record its network and captured height:

```bash
bin/strato-snapshot inspect "$SNAPSHOT_SOURCE"
```

Restore the snapshot:

```bash
bin/strato-snapshot restore "$NODE_DIR" \
  --source "$SNAPSHOT_SOURCE" \
  --network "$SNAPSHOT_NETWORK"
```

Expected result:

- The command exits `0`.
- `postgres/`, `redis/`, `kafka/`, `.ethereumH/`, and
  `secrets/postgres_password` exist under `$NODE_DIR`.
- Existing host-specific files such as `docker-compose.yml` and
  `.ethereumH/ethconf.yaml` are preserved or generated locally.
- Local database passwords and localhost database hosts in
  `.ethereumH/ethconf.yaml` are rewritten for the restored stores.

## Start And Watch

Start the restored node:

```bash
bin/strato-up "$NODE_DIR"
```

Confirm containers are up:

```bash
cd "$NODE_DIR"
docker compose -p strato ps
cd -
```

Watch logs in another terminal:

```bash
tail -F "$NODE_DIR"/logs/*.log
```

If `strato-up` fails, collect the logs and skip to the cleanup section.

## Health Checks

Wait for the metadata endpoint:

```bash
until curl -sf http://127.0.0.1:3000/eth/v1.2/metadata | jq .; do
  sleep 10
done
```

Capture the main sync fields:

```bash
curl -sf http://127.0.0.1:3000/eth/v1.2/metadata \
  | jq '{isSynced, nodeBestBlock, sequencedBestBlock, worldBestBlock}'
```

Check the API-indexer tip:

```bash
curl -sf http://127.0.0.1:3000/eth/v1.2/block/last/1 \
  | jq '.[0].blockData.number'
```

Check the fallback database tips:

```bash
POSTGRES_CONTAINER="$(cd "$NODE_DIR" && docker compose -p strato ps -q postgres)"

docker exec "$POSTGRES_CONTAINER" \
  psql -U postgres -d eth -tAc \
  "select coalesce(max(number), 0) from block_data_ref where is_confirmed = true;"

docker exec "$POSTGRES_CONTAINER" \
  psql -U postgres -d cirrus -tAc \
  "select coalesce(max(block_number::numeric), 0)::bigint from storage where block_number ~ '^[0-9]+$';"
```

## Ingest Validation

The restored node should start at or above the snapshot height from
`strato-snapshot inspect` and then ingest any newer network blocks.

Record the initial state:

```bash
date -u
curl -sf http://127.0.0.1:3000/eth/v1.2/metadata \
  | tee /tmp/snapshot-test-metadata-start.json \
  | jq '{isSynced, nodeBestBlock, sequencedBestBlock, worldBestBlock}'
```

Wait 10 minutes, then record the state again:

```bash
sleep 600
date -u
curl -sf http://127.0.0.1:3000/eth/v1.2/metadata \
  | tee /tmp/snapshot-test-metadata-end.json \
  | jq '{isSynced, nodeBestBlock, sequencedBestBlock, worldBestBlock}'
```

Success criteria:

- The node starts without Postgres crash-recovery loops, LevelDB lock errors, or
  Kafka/Redis load failures.
- `nodeBestBlock` is at or above the snapshot's captured height.
- `sequencedBestBlock` and `worldBestBlock` are present and not obviously stuck
  far behind `nodeBestBlock`.
- The API-indexer and Cirrus tips are readable.
- If the network has new blocks, tips move forward after startup.
- If the network is not producing new blocks, the node remains healthy and
  serves metadata from the restored height.

## Failure Signals

Report a failure if any of these happen:

- `strato-snapshot restore` exits nonzero.
- `strato-up` exits successfully but containers immediately stop.
- Metadata never becomes available.
- Logs show Postgres cannot start, enters repeated crash recovery, or rejects
  connections due to password mismatch.
- Logs show LevelDB lock/corruption errors.
- Logs show Kafka or Redis cannot load restored state.
- Metadata height is below the snapshot's captured height.
- API-indexer or Cirrus cannot read their restored stores after the node starts.

## Cleanup

Stop the node:

```bash
bin/strato-down "$NODE_DIR" || true
cd "$NODE_DIR"
docker compose -p strato down --remove-orphans
cd -
```

After logs are collected, remove the test directory if you no longer need it:

```bash
rm -rf "$NODE_DIR"
```

## Report Template

Send this summary back to the team:

```text
Snapshot source:
Snapshot network:
Machine/OS:
Docker version:
Restore result:
Start result:
Initial metadata:
Final metadata:
API-indexer tip:
Cirrus tip:
Errors observed:
Logs attached:
```
