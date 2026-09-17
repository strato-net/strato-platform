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
- `python3`, `curl` (or `wget`), `tar`, and `lsof`.
- `aws` CLI only when **publishing** to S3. Restoring/inspecting from the public
  bucket uses plain HTTPS via `curl`/`wget` and needs no AWS CLI or credentials.
- Enough disk for the archive and restored node data.

Extraction uses a single working directory, `<repo>/.snapshot-work` (override
with `STRATO_SNAPSHOT_WORKDIR`; falls back to `$TMPDIR/strato-snapshot`). It is
purged at the start of every run and removed on exit, so repeated restores do
not accumulate temp files.

Downloaded archives are kept in a persistent directory, `./.snapshot-downloads`
under the current directory (override with `STRATO_SNAPSHOT_DOWNLOAD_DIR`).
Before downloading, the tool compares the local copy's SHA-256 against the
snapshot's published `.sha256` on S3; if they match, the existing file is reused
instead of re-downloaded. To keep that comparison cheap, the digest of a
downloaded archive is computed from the stream while it downloads (no second
read of the file to verify it) and recorded beside it in `<archive>.verified`
together with the file's size and mtime. Later runs trust the record while the
file is unchanged; a changed size or mtime forces a re-hash. Downloads land in
`<archive>.part` and are renamed into place only after the checksum matched,
so a crashed or corrupt download never looks like a good cached archive.

The cache holds one archive per network: after a successful download, other
archives of the same network in the directory (a previous `latest`, another
timestamp, an earlier snapshot version, or the old unversioned
`<network>-latest.tar.zst` naming) are deleted, along with their `.verified`
records and any leftover `.part` files. When the object being fetched has a
published `.sha256`, this pruning happens before the download so the space is
free for it. Archives of other networks are never touched. Caches from
`strato-snapshot` builds older than the move to the current directory may still
sit in `~/.local/.snapshot-downloads` and can simply be deleted.

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

You can restore directly from an explicit S3 URI when your AWS profile has access:

```bash
bin/strato-snapshot restore "$NODE_DIR" \
  --source s3://strato-snapshots/helium/v2/helium-20260601-130500Z.tar.zst \
  --network helium
```

### Restore from the published bucket (`--snapshot`)

Instead of an explicit `--source`, use `--snapshot` to resolve the published
artifact for a network from the snapshot bucket. Without a timestamp this
downloads the `latest` alias; with a timestamp it selects that specific
snapshot:

```bash
# Latest published helium snapshot:
bin/strato-snapshot restore "$NODE_DIR" --snapshot --network helium

# A specific snapshot by UTC timestamp (YYYYMMDD-HH:mm:ssZ):
bin/strato-snapshot restore "$NODE_DIR" \
  --snapshot=20260601-13:05:00Z \
  --network helium
```

Resolved keys are scoped by **snapshot version** (`SNAPSHOT_VERSION` in
`bin/strato-snapshot`, currently `v2`):
`s3://<bucket>/<network>/<version>/<key>`. The version is bumped whenever the
captured state stops being readable by the previous version's nodes, so an
older build keeps resolving its own `latest`. v1 (kafka streaming) is the bare
`s3://<bucket>/<network>/` root — the original unversioned layout, frozen and
no longer published to; v2 carries jlog streaming state.

The bucket defaults to `strato-snapshots` and can be overridden with the
`STRATO_SNAPSHOT_BUCKET` environment variable or `--bucket <name>`. The same
`--snapshot[=<timestamp>]` / `--bucket` options work for `inspect` and
`smoke-test`. Downloaded archives are verified against their published
`.sha256` sidecar before use.

### Start a node directly from a snapshot (`strato-up --snapshot`)

`strato-up` accepts `--snapshot[=<timestamp>]`. It runs `strato-setup` to
generate config, restores the published snapshot for the selected `--network`
(default `upquark`), then starts the node:

```bash
# Latest upquark snapshot:
bin/strato-up mynode --network=upquark --snapshot

# Specific helium snapshot:
bin/strato-up mynode --network=helium --snapshot=20260601-13:05:00Z
```

### Pre-download a snapshot before a restart (`pull`)

`strato-snapshot pull` downloads a published snapshot into the download cache
(`.snapshot-downloads/`, see above) without touching any node. A later restore
of the same snapshot finds the archive there with a matching SHA-256 and skips
the download, so the slow part of a from-snapshot restart happens while the old
node is still serving:

```bash
# While the node is still running: fetch the latest published snapshot for the
# network mynode is configured for.
bin/strato-snapshot pull mynode

# Then restart from it. The restore reuses the archive pulled above.
bin/strato-down mynode && rm -rf mynode && bin/strato-up mynode --network=helium --snapshot
```

Without `--snapshot=<timestamp>` or `--source <s3-uri>`, `pull` fetches the
`latest` alias. Without `--network`, it uses the network of the given
`<node-dir>`, or of the default node recorded by `strato-setup`
(`~/.strato/default-node`) when no node directory is given, so a bare
`bin/strato-snapshot pull` works for the last node you set up. It refuses a
`--network` that contradicts the node's own configuration.

```bash
bin/strato-snapshot pull --network helium                          # latest helium
bin/strato-snapshot pull --network helium --snapshot=20260601-13:05:00Z
bin/strato-snapshot pull --source s3://strato-snapshots/helium/v2/helium-20260601-130500Z.tar.zst
```

The cache is keyed on the working directory (`./.snapshot-downloads`, or
`STRATO_SNAPSHOT_DOWNLOAD_DIR` when set), so run `pull` from the directory you
will run `strato-up`/`restore` from. `pull` prints the cached archive path on
stdout. A local `--source` is rejected, since there is nothing to download.
Restore always installs the snapshot it resolves at restore time: if `latest`
was re-published between the pull and the restore, the checksum no longer
matches and the newer archive is downloaded, so a stale pull only costs the
download it was meant to save.

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

Before the cold shutdown, `create` asks the node's Redis for a `BGREWRITEAOF`
and waits for it (bounded at ten minutes, best effort). The append-only file is
Redis's write history since its last rewrite; Redis rewrites it on its own only
once it has doubled, so at any moment it is between one and two times the size
of the dataset it encodes. Compacting it right before the snapshot means the
archive carries the dataset once, saving up to half of the Redis payload
depending on when Redis last rewrote it. The staged `.ethereumH` payload also
leaves out LevelDB's `LOG` and `LOG.old` activity logs in each database
directory, which carry no state and are recreated on open.

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
bin/strato-snapshot publish /tmp/helium-20260601-130500Z.tar.zst \
  --destination s3://strato-snapshots/helium/v2/ \
  --alias latest
```

`publish` uploads or copies the artifact, a `.sha256` checksum, and optional
alias files. Run smoke tests before publishing; `publish` does not enforce that
itself.

## Nightly creation in CI

`scripts/create-and-publish-snapshot.sh` wraps `create` + `publish` for use in
Jenkins. It snapshots a running, synced node and publishes both a timestamped
artifact and the `latest` alias under the network prefix:

```bash
scripts/create-and-publish-snapshot.sh \
  --node-dir mynode \
  --network upquark \
  --bucket strato-snapshots \
  --wait-timeout 600 \
  --strict-layers
```

`pipelines/Jenkinsfile.synctest` builds STRATO, deploys with `strato-up` on
each network (helium then upquark), measures sync time, and on a successful
sync runs this script to refresh the published snapshots.

## Snapshot Contents

The snapshot carries only public blockchain data, so a snapshot can be restored
onto any new node started by any user with their own configuration.

Included payload:

- `.ethereumH/` state, excluding `ethconf.yaml`
- `postgres-dumps/eth.dump` and `postgres-dumps/cirrus.dump` — `pg_dump` custom
  format (`-Fc`) of the public blockchain databases only; restored in parallel
  with `pg_restore -j`
- `redis/`
- `jlog/` (segments and per-subscriber `cp.*` checkpoints; jlog is embedded, so this one dir is the whole streaming state)
- `prometheus/` only when requested

Excluded payload:

- The raw `postgres/` data directory and the local-only `oauth` database
  (node key and user wallet keys live there and are never captured)
- `secrets/` entirely (including `secrets/postgres_password`, `vault_password`,
  OAuth credentials/tokens, SSL secrets, local-auth secrets)
- `logs/`
- `.strato.pid`
- `.ethereumH/ethconf.yaml`
- macOS AppleDouble metadata files (`._*`)

The `eth`/`cirrus` databases are dumped with a throwaway `postgres:14.18`
container against the cleanly-stopped data directory. On restore, the load-time
container runs with relaxed durability (`fsync=off`, `synchronous_commit=off`)
and `pg_restore -j` for a fast parallel restore; this is safe because the data
is disposable until the restore completes. The extracted dumps are bind-mounted
read-only into that container at `/dumps` rather than copied into it. The dumps
hold table data only, so most of the load time is Postgres rebuilding indexes;
on a synced node the Cirrus indexes alone are several times the size of the
dump.

`restore` narrates what it does in seven numbered steps on stderr: the plan,
fetching the archive (cache hit or download), extraction with size and file
count, the compatibility checks, replacing the chain state, loading the two
databases (with per-database timing), and finalizing. Each line says what the
step does and why it takes the time it does.

Restore preserves the target node's generated host config and its own
credentials: it loads the `eth`/`cirrus` dumps into the node's postgres cluster
(initializing the cluster with the node's own `secrets/postgres_password` if it
is a fresh node), and never imports the snapshot's postgres password. Restore
also normalizes local `localhost` SQL and Cirrus hosts to `127.0.0.1` so host
processes connect to the IPv4-only Docker port bindings.

Because only the public `eth`/`cirrus` databases are captured and restored,
**local-auth nodes are safe on both sides**: `create` never dumps the local-only
`oauth` database (node key, admin/user wallet keys), and `restore` leaves the
target node's own `oauth` database intact while replacing only `eth`/`cirrus`.

## More Detail

- Interface design: `design-documents/node-snapshot-dev-loop.md`
- Employee validation runbook:
  `design-documents/node-snapshot-employee-test-instructions.md`
- Fixture tests: `scripts/test-strato-snapshot.sh`
