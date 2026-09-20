#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$ROOT/bin/strato-snapshot"
TMP="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

assert_file() {
  [[ -f "$1" ]] || {
    echo "missing file: $1" >&2
    exit 1
  }
}

assert_contains() {
  grep -q -- "$2" "$1" || {
    echo "expected '$2' in $1" >&2
    exit 1
  }
}

assert_no_appledouble() {
  local path="$1"
  if find "$path" -name '._*' -print -quit | grep -q .; then
    echo "unexpected AppleDouble metadata under $path" >&2
    exit 1
  fi
}

# jlog writes its segments 0640 and topic dirs 0750 owned by whoever ran the
# node, so the restored jlog tree must be relaxed to be readable and writable by
# any uid: files o+rw, dirs o+rwx.
assert_jlog_modes_relaxed() {
  local jlog_dir="$1"
  local bad
  bad="$({ find "$jlog_dir" -type f ! -perm -0006; find "$jlog_dir" -type d ! -perm -0007; })"
  if [[ -n "$bad" ]]; then
    echo "jlog payload entries not world-read/writable after restore:" >&2
    echo "$bad" >&2
    exit 1
  fi
}

make_fixture_snapshot() {
  local staging="$TMP/staging"
  mkdir -p "$staging/payload/ethereumH/state"
  mkdir -p "$staging/payload/postgres-dumps"
  mkdir -p "$staging/payload/redis"
  mkdir -p "$staging/payload/jlog/vmevents"

  echo "state-from-snapshot" > "$staging/payload/ethereumH/state/value"
  echo "eth dump fixture" > "$staging/payload/postgres-dumps/eth.dump"
  echo "cirrus dump fixture" > "$staging/payload/postgres-dumps/cirrus.dump"
  echo "redis-from-snapshot" > "$staging/payload/redis/appendonly.aof"
  echo "jlog-from-snapshot" > "$staging/payload/jlog/vmevents/00000000"
  echo "jlog-metastore" > "$staging/payload/jlog/vmevents/metastore"
  # jlog writes subscriber checkpoints tight on the source node; archives
  # published before create normalized modes carry that.
  echo "jlog-checkpoint" > "$staging/payload/jlog/vmevents/cp.73747261746f"
  chmod 600 "$staging/payload/jlog/vmevents/cp.73747261746f"

  cat > "$staging/SNAPSHOT.json" <<'JSON'
{
  "schemaVersion": 1,
  "network": "helium",
  "createdAt": "2026-04-24T00:00:00Z",
  "createdBy": "fixture",
  "stratoVersion": "16.15-fixture",
  "composeProject": "strato",
  "block": {
    "isSynced": true,
    "nodeBestBlock": 100,
    "sequencedBestBlock": 100,
    "worldBestBlock": 100,
    "apiIndexerTip": 100,
    "cirrusTip": 100
  },
  "images": {
    "strato": "strato:16.15-fixture"
  },
  "payload": [
    "ethereumH",
    "postgres-dumps/eth.dump",
    "postgres-dumps/cirrus.dump",
    "redis",
    "jlog"
  ],
  "checksums": {
    "payloadSha256": "fixture"
  },
  "compatibility": {
    "requiresSameNetwork": true,
    "requiresSameMajorVersion": true,
    "allowPatchVersionDrift": true
  }
}
JSON

  (cd "$staging" && tar -czf "$TMP/snapshot.tar.gz" .)
}

make_target_node() {
  local node="$1"
  mkdir -p "$node/.ethereumH" "$node/secrets/ssl" "$node/logs"
  cat > "$node/.ethereumH/ethconf.yaml" <<'YAML'
apiConfig:
  apiListenAddress: 127.0.0.1
  apiPort: 3000
cirrusConfig:
  database: cirrus
  host: localhost
  password: oldpass
  poolsize: 10
  port: 5432
  user: postgres
networkConfig:
  httpPort: 8081
  network: helium
sqlConfig:
  database: eth
  host: localhost
  password: oldpass
  poolsize: 10
  port: 5432
  user: postgres
urlConfig:
  nodeUrl: http://local-dev-node:8081
YAML
  cat > "$node/docker-compose.yml" <<'YAML'
services:
  strato:
    image: strato:16.15-local
  postgres:
    image: postgres:14.18
YAML
  echo 'clientId: "keep-me"' > "$node/secrets/oauth_credentials.yaml"
  echo "ssl-key" > "$node/secrets/ssl/server.key"
  echo "generatedpass" > "$node/secrets/postgres_password"
  chmod 444 "$node/secrets/postgres_password"
  echo "old log" > "$node/logs/keep.log"
  echo "CONVOKE_PID=999999" > "$node/.strato.pid"
}

make_fixture_snapshot
NODE="$TMP/node"
make_target_node "$NODE"

STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" inspect "$TMP/snapshot.tar.gz" > "$TMP/inspect.out"
assert_contains "$TMP/inspect.out" "network: helium"
assert_contains "$TMP/inspect.out" "nodeBestBlock: 100"

STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" restore "$NODE" --source "$TMP/snapshot.tar.gz" --network helium

assert_file "$NODE/.ethereumH/ethconf.yaml"
assert_file "$NODE/.ethereumH/state/value"
assert_file "$NODE/redis/appendonly.aof"
assert_file "$NODE/jlog/vmevents/00000000"
assert_file "$NODE/jlog/vmevents/cp.73747261746f"
assert_jlog_modes_relaxed "$NODE/jlog"
assert_file "$NODE/secrets/oauth_credentials.yaml"
assert_file "$NODE/secrets/ssl/server.key"
assert_file "$NODE/secrets/postgres_password"
assert_file "$NODE/logs/keep.log"
[[ ! -f "$NODE/.strato.pid" ]] || {
  echo ".strato.pid should be removed during restore" >&2
  exit 1
}

assert_contains "$NODE/.ethereumH/state/value" "state-from-snapshot"
assert_contains "$NODE/.ethereumH/ethconf.yaml" "nodeUrl: http://local-dev-node:8081"
assert_contains "$NODE/.ethereumH/ethconf.yaml" "host: 127.0.0.1"
if grep -q "host: localhost" "$NODE/.ethereumH/ethconf.yaml"; then
  echo "restore should rewrite local database hosts to 127.0.0.1" >&2
  exit 1
fi
# A2: the node keeps its own postgres password; restore must not import the
# snapshot's credentials into ethconf or secrets.
assert_contains "$NODE/secrets/postgres_password" "generatedpass"
if grep -q "password: snapshotpass" "$NODE/.ethereumH/ethconf.yaml"; then
  echo "restore must not import the snapshot postgres password (A2)" >&2
  exit 1
fi
assert_no_appledouble "$NODE"

if STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" restore "$NODE" --source "$TMP/snapshot.tar.gz" --network helium >/tmp/strato-snapshot-restore.out 2>&1; then
  echo "restore should reject existing state without --force" >&2
  exit 1
fi

STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" restore "$NODE" --source "$TMP/snapshot.tar.gz" --network helium --force
assert_no_appledouble "$NODE"

cat > "$TMP/metadata.json" <<'JSON'
{
  "isSynced": true,
  "nodeBestBlock": 100,
  "sequencedBestBlock": 100,
  "worldBestBlock": 100
}
JSON
cat > "$TMP/last.json" <<'JSON'
[
  {
    "blockData": {
      "number": 100
    }
  }
]
JSON
cat > "$TMP/cirrus.json" <<'JSON'
[
  {
    "block_number": 100
  }
]
JSON

CREATED="$TMP/created.tar.gz"
echo "appledouble" > "$NODE/.ethereumH/state/._value"
# LevelDB's informational LOG / LOG.old carry no state and must not be archived.
echo "leveldb activity log" > "$NODE/.ethereumH/state/LOG"
echo "older leveldb activity log" > "$NODE/.ethereumH/state/LOG.old"
echo "appledouble" > "$NODE/jlog/vmevents/._00000000"
# Re-tighten the checkpoint to how jlog leaves it on a live node, so the create
# below has to normalize it (the restore above already relaxed it).
chmod 600 "$NODE/jlog/vmevents/cp.73747261746f"
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$CREATED" \
  --metadata-url "file://$TMP/metadata.json" \
  --last-block-url "file://$TMP/last.json" \
  --cirrus-tip-url "file://$TMP/cirrus.json" \
  --strict-layers \
  --skip-smoke-test

STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" inspect "$CREATED" > "$TMP/created-inspect.out"
assert_contains "$TMP/created-inspect.out" "apiIndexerTip: 100"
assert_contains "$TMP/created-inspect.out" "cirrusTip: 100"
if tar -tzf "$CREATED" | grep -E 'ethereumH/state/LOG(\.old)?$' > "$TMP/created-leveldb-log.out"; then
  echo "created archive should not contain LevelDB LOG / LOG.old" >&2
  cat "$TMP/created-leveldb-log.out" >&2
  exit 1
fi
tar -tzf "$CREATED" | grep -q 'ethereumH/state/value$' || { echo "created archive is missing the state payload" >&2; exit 1; }
if tar -tzf "$CREATED" | grep -E '(^|/)\._' > "$TMP/created-appledouble.out"; then
  echo "created archive should not contain AppleDouble metadata" >&2
  cat "$TMP/created-appledouble.out" >&2
  exit 1
fi
# The archive itself must record relaxed jlog modes, so even a manual tar -xp
# restore yields state the node's processes can use on hosts whose uid differs.
if tar -tvzf "$CREATED" | grep "vmevents/cp.73747261746f" | grep -qv "^-rw-rw-rw-"; then
  echo "created archive should carry relaxed (0666) jlog checkpoint modes" >&2
  tar -tvzf "$CREATED" | grep "vmevents" >&2
  exit 1
fi

# Real-STRATO metadata shape: /eth/v1.2/metadata exposes isSynced but NOT
# nodeBestBlock/sequencedBestBlock/worldBestBlock. With --strict-layers, the
# node/sequencer tips must be sourced from apex /status instead.
cat > "$TMP/metadata-nostatusfields.json" <<'JSON'
{
  "isSynced": true,
  "validators": [],
  "networkName": "helium"
}
JSON
cat > "$TMP/status.json" <<'JSON'
{
  "lastBlock": { "number": 100 },
  "pbftData": { "sequence_number": 100 }
}
JSON
CREATED_STATUS="$TMP/created-status.tar.gz"
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$CREATED_STATUS" \
  --metadata-url "file://$TMP/metadata-nostatusfields.json" \
  --status-url "file://$TMP/status.json" \
  --last-block-url "file://$TMP/last.json" \
  --cirrus-tip-url "file://$TMP/cirrus.json" \
  --strict-layers \
  --skip-smoke-test

STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" inspect "$CREATED_STATUS" > "$TMP/created-status-inspect.out"
assert_contains "$TMP/created-status-inspect.out" "nodeBestBlock: 100"
assert_contains "$TMP/created-status-inspect.out" "sequencedBestBlock: 100"

DOCKER_FAKEBIN="$TMP/docker-fakebin"
mkdir -p "$DOCKER_FAKEBIN"
cat > "$DOCKER_FAKEBIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
if [[ "${1:-}" == "compose" ]]; then
  echo "fake-postgres"
  exit 0
fi
if [[ "${1:-}" == "exec" ]]; then
  db=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "-d" ]]; then
      db="$arg"
      break
    fi
    prev="$arg"
  done
  case "$db" in
    eth|cirrus) echo "100"; exit 0 ;;
  esac
fi
echo "unexpected docker invocation: $*" >&2
exit 1
SH
chmod +x "$DOCKER_FAKEBIN/docker"
FAKE_DOCKER_LOG="$TMP/docker-fallback.log" PATH="$DOCKER_FAKEBIN:$PATH" STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$TMP/fallback-created.tar.gz" \
  --metadata-url "file://$TMP/metadata.json" \
  --strict-layers \
  --skip-smoke-test
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" inspect "$TMP/fallback-created.tar.gz" > "$TMP/fallback-inspect.out"
assert_contains "$TMP/fallback-inspect.out" "apiIndexerTip: 100"
assert_contains "$TMP/fallback-inspect.out" "cirrusTip: 100"
assert_contains "$TMP/docker-fallback.log" "-f $NODE/docker-compose.yml"

cat > "$TMP/metadata-unsynced.json" <<'JSON'
{
  "isSynced": false,
  "nodeBestBlock": 99,
  "sequencedBestBlock": 99,
  "worldBestBlock": 100
}
JSON
if STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$TMP/unsynced.tar.gz" \
  --metadata-url "file://$TMP/metadata-unsynced.json" \
  --last-block-url "file://$TMP/last.json" \
  --cirrus-tip-url "file://$TMP/cirrus.json" \
  --wait-timeout 0 \
  --skip-smoke-test \
  > "$TMP/unsynced.out" 2> "$TMP/unsynced.err"; then
  echo "create should reject unsynced metadata" >&2
  exit 1
fi
assert_contains "$TMP/unsynced.err" "Last live check"
assert_contains "$TMP/unsynced.err" "nodeBestBlock=99"
assert_contains "$TMP/unsynced.err" "sequencerLag=1"

# A synced node whose Cirrus indexer is still catching up must not fail
# immediately under --strict-layers; it should keep waiting and (with
# --wait-timeout 0) time out with the generic not-synced message rather than the
# instant "is behind" die.
cat > "$TMP/cirrus-behind.json" <<'JSON'
[
  {
    "block_number": 50
  }
]
JSON
if STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$TMP/cirrus-behind.tar.gz" \
  --metadata-url "file://$TMP/metadata.json" \
  --last-block-url "file://$TMP/last.json" \
  --cirrus-tip-url "file://$TMP/cirrus-behind.json" \
  --strict-layers \
  --wait-timeout 0 \
  --skip-smoke-test \
  > "$TMP/cirrus-behind.out" 2> "$TMP/cirrus-behind.err"; then
  echo "create should not snapshot while Cirrus is behind" >&2
  exit 1
fi
assert_contains "$TMP/cirrus-behind.err" "not synced enough to snapshot"
if grep -q "is behind node tip" "$TMP/cirrus-behind.err"; then
  : # informational waiting message is fine
fi
assert_contains "$TMP/cirrus-behind.err" "catch up"

if STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" create "$NODE" \
  --network helium \
  --output "$TMP/unreachable.tar.gz" \
  --metadata-url "http://127.0.0.1:1/nope" \
  --wait-timeout 0 \
  --skip-smoke-test \
  > "$TMP/unreachable.out" 2> "$TMP/unreachable.err"; then
  echo "create should reject unreachable metadata" >&2
  exit 1
fi
if grep -q "Traceback" "$TMP/unreachable.err"; then
  echo "create should not emit Python tracebacks for unreachable metadata" >&2
  exit 1
fi

# A v1 (kafka-era) payload has kafka/ where this build expects jlog/. Restore
# must refuse it instead of leaving a node with empty streaming state.
mkdir -p "$TMP/staging-v1"
(cd "$TMP/staging" && tar -cf - .) | (cd "$TMP/staging-v1" && tar -xf -)
rm -rf "$TMP/staging-v1/payload/jlog"
mkdir -p "$TMP/staging-v1/payload/kafka/kafka-logs"
echo "kafka-from-v1-snapshot" > "$TMP/staging-v1/payload/kafka/log"
(cd "$TMP/staging-v1" && tar -czf "$TMP/snapshot-v1.tar.gz" .)
if STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" restore "$NODE" --source "$TMP/snapshot-v1.tar.gz" --network helium --force \
    > "$TMP/restore-v1.out" 2>&1; then
  echo "restore should reject a kafka-era payload with no jlog/ state" >&2
  exit 1
fi
assert_contains "$TMP/restore-v1.out" "payload has no jlog/ streaming state"

PUBLISH="$TMP/published"
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" publish "$TMP/snapshot.tar.gz" --destination "$PUBLISH" --alias latest
assert_file "$PUBLISH/snapshot.tar.gz"
assert_file "$PUBLISH/snapshot.tar.gz.sha256"
assert_file "$PUBLISH/latest.tar.gz"
assert_file "$PUBLISH/latest.tar.gz.sha256"
assert_contains "$PUBLISH/latest.tar.gz.sha256" "latest.tar.gz"

# Snapshot source resolution (offline): exercise the helpers that map
# --snapshot[=ts] + --network + --bucket into S3 URIs under the tool's own
# snapshot version.
TOOL_VERSION="$(sed -n 's/^SNAPSHOT_VERSION="\(.*\)"$/\1/p' "$TOOL" | head -1)"
[[ -n "$TOOL_VERSION" ]] || { echo "could not read SNAPSHOT_VERSION from $TOOL" >&2; exit 1; }
RESOLVE_HELPERS="$(sed -n '/^snapshot_bucket()/,/^fetch_source()/p' "$TOOL" | sed '$d')"
resolve_uri() {
  STRATO_SNAPSHOT_BUCKET="${STRATO_SNAPSHOT_BUCKET:-}" bash -c '
    set -euo pipefail
    DEFAULT_SNAPSHOT_BUCKET="strato-snapshots"
    SNAPSHOT_ARCHIVE_EXT="tar.zst"
    SNAPSHOT_VERSION="'"$TOOL_VERSION"'"
    die(){ echo "Error: $*" >&2; exit 1; }
    warn(){ :; }
    info(){ :; }
    need_cmd(){ :; }
    mktemp_dir(){ mktemp -d; }
    sha256_file(){ :; }
    '"$RESOLVE_HELPERS"'
    resolve_selection_source "$1" "$2" "$3" "$4" "$5"
  ' _ "$@"
}

[[ "$(resolve_uri "" true "" upquark "")" == "s3://strato-snapshots/upquark/$TOOL_VERSION/latest.tar.zst" ]] \
  || { echo "latest resolution wrong" >&2; exit 1; }
[[ "$(resolve_uri "" true "20260601-13:05:00Z" helium "")" == "s3://strato-snapshots/helium/$TOOL_VERSION/helium-20260601-130500Z.tar.zst" ]] \
  || { echo "timestamp resolution wrong" >&2; exit 1; }
[[ "$(resolve_uri "" true "" helium "custom-bucket")" == "s3://custom-bucket/helium/$TOOL_VERSION/latest.tar.zst" ]] \
  || { echo "bucket override resolution wrong" >&2; exit 1; }
[[ "$(STRATO_SNAPSHOT_BUCKET=env-bucket resolve_uri "" true "" helium "")" == "s3://env-bucket/helium/$TOOL_VERSION/latest.tar.zst" ]] \
  || { echo "env bucket resolution wrong" >&2; exit 1; }
[[ "$(resolve_uri "/tmp/explicit.tar" false "" helium "")" == "/tmp/explicit.tar" ]] \
  || { echo "explicit source passthrough wrong" >&2; exit 1; }
if resolve_uri "/tmp/explicit.tar" true "" helium "" 2>/dev/null; then
  echo "--source and --snapshot should be mutually exclusive" >&2
  exit 1
fi
if resolve_uri "" true "not-a-timestamp" helium "" 2>/dev/null; then
  echo "invalid timestamp should be rejected" >&2
  exit 1
fi
if resolve_uri "" false "" helium "" 2>/dev/null; then
  echo "missing source/snapshot should be rejected" >&2
  exit 1
fi

# pull: pre-download a published snapshot into the persistent download cache.
# A fake curl serves https://<bucket>.s3.<region>.amazonaws.com/<key> from a
# local directory standing in for the bucket. Covers download + checksum
# verification, cache reuse on a second pull, network inference from a node dir
# and from ~/.strato/default-node, the rejections, and that a later restore of
# the same snapshot reuses the pulled archive instead of downloading again.
CURL_FAKEBIN="$TMP/curl-fakebin"
FAKE_S3_ROOT="$TMP/fake-s3"
mkdir -p "$CURL_FAKEBIN" "$FAKE_S3_ROOT"
cat > "$CURL_FAKEBIN/curl" <<'SH'
#!/usr/bin/env bash
# Fake curl for the pull tests. Understands -o <dest>, HEAD (an I in any flag
# cluster) and -f semantics (exit 22 on a missing object). Logs every request
# as "<url>" or "HEAD <url>".
set -euo pipefail
dest=""
head="false"
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) dest="$2"; shift 2 ;;
    -*)
      if [[ "$1" == -[a-zA-Z]* && "$1" == *I* ]]; then head="true"; fi
      shift ;;
    *) url="$1"; shift ;;
  esac
done
if [[ "$head" == "true" ]]; then
  printf 'HEAD %s\n' "$url" >> "${FAKE_CURL_LOG:?}"
else
  printf '%s\n' "$url" >> "${FAKE_CURL_LOG:?}"
fi
key="${url#https://*.amazonaws.com/}"
obj="${FAKE_S3_ROOT:?}/$key"
[[ -f "$obj" ]] || exit 22
if [[ "$head" == "true" ]]; then
  printf 'HTTP/1.1 200 OK\r\nContent-Length: %s\r\n\r\n' "$(wc -c < "$obj" | tr -d ' ')"
  exit 0
fi
if [[ -n "$dest" ]]; then cp "$obj" "$dest"; else cat "$obj"; fi
SH
chmod +x "$CURL_FAKEBIN/curl"

# Number of archive downloads (non-HEAD requests) for a key in a fake-curl log.
curl_downloads() {
  grep -v '^HEAD ' "$1" | grep -c -- "/$2\$" || true
}

# Populate the fake bucket with the tool's own publish, then add the .tar.zst
# keys --snapshot resolves to. pull only caches bytes (it never extracts), so
# the gzip fixture can stand in for the zstd archives here.
FAKE_BUCKET_DIR="$FAKE_S3_ROOT/helium/$TOOL_VERSION"
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" publish "$TMP/snapshot.tar.gz" --destination "$FAKE_BUCKET_DIR"
for zst_key in latest.tar.zst helium-20260601-130500Z.tar.zst; do
  cp "$TMP/snapshot.tar.gz" "$FAKE_BUCKET_DIR/$zst_key"
  sed "s/snapshot.tar.gz/$zst_key/" "$FAKE_BUCKET_DIR/snapshot.tar.gz.sha256" > "$FAKE_BUCKET_DIR/$zst_key.sha256"
done

PULL_DL="$TMP/pull-downloads"
PULL_ENV=(STRATO_SNAPSHOT_OFFLINE_TEST=1 STRATO_SNAPSHOT_DOWNLOAD_DIR="$PULL_DL" PATH="$CURL_FAKEBIN:$PATH" FAKE_S3_ROOT="$FAKE_S3_ROOT")
PULLED_LATEST="$PULL_DL/helium-$TOOL_VERSION-latest.tar.zst"

# Seed the cache with what accumulates on a real host: a helium archive under
# the old unversioned naming, a helium archive of another key, a leftover partial
# download, and an archive of another network (which must survive).
mkdir -p "$PULL_DL"
echo "old v1 naming" > "$PULL_DL/helium-latest.tar.zst"
echo "old key" > "$PULL_DL/helium-$TOOL_VERSION-helium-20200101-000000Z.tar.zst"
echo "sha256 0 size 7 mtime 0" > "$PULL_DL/helium-$TOOL_VERSION-helium-20200101-000000Z.tar.zst.verified"
echo "partial" > "$PULL_DL/helium-$TOOL_VERSION-latest.tar.zst.part"
echo "other network" > "$PULL_DL/upquark-$TOOL_VERSION-latest.tar.zst"

# Latest for an explicit --network: downloads, verifies, prints only the path.
FAKE_CURL_LOG="$TMP/curl-pull-1.log" env "${PULL_ENV[@]}" "$TOOL" pull --network helium \
  > "$TMP/pull-1.out" 2> "$TMP/pull-1.err"
[[ "$(cat "$TMP/pull-1.out")" == "$PULLED_LATEST" ]] \
  || { echo "pull should print the cached archive path on stdout, got: $(cat "$TMP/pull-1.out")" >&2; exit 1; }
assert_file "$PULLED_LATEST"
cmp -s "$PULLED_LATEST" "$TMP/snapshot.tar.gz" || { echo "pulled archive differs from the published one" >&2; exit 1; }
[[ "$(curl_downloads "$TMP/curl-pull-1.log" "helium/$TOOL_VERSION/latest.tar.zst")" == "1" ]] \
  || { echo "first pull should download latest.tar.zst exactly once" >&2; cat "$TMP/curl-pull-1.log" >&2; exit 1; }
assert_contains "$TMP/pull-1.err" "Verified snapshot checksum"
assert_contains "$TMP/pull-1.err" "Snapshot cached: $PULLED_LATEST"
# Pruning: the other helium archives (and their leftovers) are gone, upquark stays.
assert_contains "$TMP/pull-1.err" "Removing a stale cached archive of helium"
for stale in "helium-latest.tar.zst" "helium-$TOOL_VERSION-helium-20200101-000000Z.tar.zst" \
             "helium-$TOOL_VERSION-helium-20200101-000000Z.tar.zst.verified" "helium-$TOOL_VERSION-latest.tar.zst.part"; do
  [[ ! -e "$PULL_DL/$stale" ]] || { echo "pull should prune stale cache entry $stale" >&2; exit 1; }
done
assert_file "$PULL_DL/upquark-$TOOL_VERSION-latest.tar.zst"
assert_contains "$TMP/pull-1.err" "strato-up <node-dir> --network=helium --snapshot"

# Second pull of the same snapshot: checksum still matches, no re-download.
FAKE_CURL_LOG="$TMP/curl-pull-2.log" env "${PULL_ENV[@]}" "$TOOL" pull --network helium \
  > "$TMP/pull-2.out" 2> "$TMP/pull-2.err"
[[ "$(cat "$TMP/pull-2.out")" == "$PULLED_LATEST" ]] || { echo "second pull should print the same path" >&2; exit 1; }
assert_contains "$TMP/pull-2.err" "reusing the cached archive"
# The digest verified on the first pull is recorded beside the archive and
# trusted while the file is unchanged, so the second pull re-reads nothing.
assert_file "$PULLED_LATEST.verified"
assert_contains "$PULLED_LATEST.verified" "^sha256 $(awk '{print $1}' "$FAKE_BUCKET_DIR/latest.tar.zst.sha256")\$"
assert_contains "$TMP/pull-2.err" "recorded when it was last verified"
if grep -q "Hashing it" "$TMP/pull-2.err"; then
  echo "second pull should not re-hash an unchanged cached archive" >&2
  exit 1
fi
[[ "$(curl_downloads "$TMP/curl-pull-2.log" "helium/$TOOL_VERSION/latest.tar.zst")" == "0" ]] \
  || { echo "second pull should not re-download latest.tar.zst" >&2; cat "$TMP/curl-pull-2.log" >&2; exit 1; }
[[ ! -e "$PULLED_LATEST.part" ]] || { echo "no partial download should remain after a successful pull" >&2; exit 1; }

# --network inferred from a positional <node-dir> (the fixture node is helium).
FAKE_CURL_LOG="$TMP/curl-pull-3.log" env "${PULL_ENV[@]}" "$TOOL" pull "$NODE" \
  > "$TMP/pull-3.out" 2> "$TMP/pull-3.err"
[[ "$(cat "$TMP/pull-3.out")" == "$PULLED_LATEST" ]] || { echo "pull <node-dir> should resolve the node's network" >&2; exit 1; }

# --network inferred from the default node recorded by strato-setup.
FAKE_HOME="$TMP/home"
mkdir -p "$FAKE_HOME/.strato"
printf '%s' "$NODE" > "$FAKE_HOME/.strato/default-node"
HOME="$FAKE_HOME" FAKE_CURL_LOG="$TMP/curl-pull-4.log" env "${PULL_ENV[@]}" "$TOOL" pull \
  > "$TMP/pull-4.out" 2> "$TMP/pull-4.err"
[[ "$(cat "$TMP/pull-4.out")" == "$PULLED_LATEST" ]] || { echo "bare pull should use the default node's network" >&2; exit 1; }
assert_contains "$TMP/pull-4.err" "default node: $NODE"

# A cached archive whose mtime no longer matches its record is re-hashed (and,
# still matching S3, reused); the record is refreshed.
touch -t 202001010000 "$PULLED_LATEST"
FAKE_CURL_LOG="$TMP/curl-pull-4b.log" env "${PULL_ENV[@]}" "$TOOL" pull --network helium \
  > "$TMP/pull-4b.out" 2> "$TMP/pull-4b.err"
assert_contains "$TMP/pull-4b.err" "Hashing it to compare with S3"
assert_contains "$TMP/pull-4b.err" "reusing the cached archive"
[[ "$(curl_downloads "$TMP/curl-pull-4b.log" "helium/$TOOL_VERSION/latest.tar.zst")" == "0" ]] \
  || { echo "a re-hashed cached archive that matches S3 should not be re-downloaded" >&2; exit 1; }
[[ "$(cached_mtime="$(awk '$1=="mtime"{print $2}' "$PULLED_LATEST.verified")"; stat -c %Y "$PULLED_LATEST" 2>/dev/null || stat -f %m "$PULLED_LATEST")" == "$(awk '$1=="mtime"{print $2}' "$PULLED_LATEST.verified")" ]] \
  || { echo "the verification record should be refreshed after re-hashing" >&2; exit 1; }

# A specific timestamp resolves to its own key and cache entry.
FAKE_CURL_LOG="$TMP/curl-pull-5.log" env "${PULL_ENV[@]}" "$TOOL" pull --network helium --snapshot=20260601-13:05:00Z \
  > "$TMP/pull-5.out" 2> "$TMP/pull-5.err"
[[ "$(cat "$TMP/pull-5.out")" == "$PULL_DL/helium-$TOOL_VERSION-helium-20260601-130500Z.tar.zst" ]] \
  || { echo "pull --snapshot=<ts> should cache the timestamped key, got: $(cat "$TMP/pull-5.out")" >&2; exit 1; }
assert_contains "$TMP/pull-5.err" "strato-up <node-dir> --network=helium --snapshot=20260601-13:05:00Z"
[[ ! -e "$PULLED_LATEST" ]] || { echo "downloading another helium key should prune the previous helium archive" >&2; exit 1; }
assert_file "$PULL_DL/upquark-$TOOL_VERSION-latest.tar.zst"

# Rejections: no way to determine the network; --network contradicting the
# node's config; a local --source (nothing to pull); a node dir that is missing.
if HOME="$TMP/home-empty" FAKE_CURL_LOG="$TMP/curl-pull-6.log" env "${PULL_ENV[@]}" "$TOOL" pull \
    > "$TMP/pull-6.out" 2>&1; then
  echo "pull without --network, <node-dir> or a default node should fail" >&2
  exit 1
fi
assert_contains "$TMP/pull-6.out" "--network is required"
if FAKE_CURL_LOG="$TMP/curl-pull-7.log" env "${PULL_ENV[@]}" "$TOOL" pull "$NODE" --network upquark \
    > "$TMP/pull-7.out" 2>&1; then
  echo "pull should reject --network that contradicts the node's configured network" >&2
  exit 1
fi
assert_contains "$TMP/pull-7.out" "configured for network 'helium', not 'upquark'"
if FAKE_CURL_LOG="$TMP/curl-pull-8.log" env "${PULL_ENV[@]}" "$TOOL" pull --source "$TMP/snapshot.tar.gz" \
    > "$TMP/pull-8.out" 2>&1; then
  echo "pull should reject a local --source" >&2
  exit 1
fi
assert_contains "$TMP/pull-8.out" "s3:// sources only"
if FAKE_CURL_LOG="$TMP/curl-pull-9.log" env "${PULL_ENV[@]}" "$TOOL" pull "$TMP/no-such-node" \
    > "$TMP/pull-9.out" 2>&1; then
  echo "pull should reject a missing <node-dir>" >&2
  exit 1
fi
assert_contains "$TMP/pull-9.out" "node directory not found"
[[ ! -e "$PULL_DL/helium-$TOOL_VERSION-snapshot.tar.gz" ]] || { echo "rejected pulls must not download" >&2; exit 1; }

# The point of pull: an explicit s3 source pulled now is reused by a restore
# later, with no archive download during the restore.
GZ_URI="s3://strato-snapshots/helium/$TOOL_VERSION/snapshot.tar.gz"
PULLED_GZ="$PULL_DL/helium-$TOOL_VERSION-snapshot.tar.gz"
FAKE_CURL_LOG="$TMP/curl-pull-gz.log" env "${PULL_ENV[@]}" "$TOOL" pull --source "$GZ_URI" \
  > "$TMP/pull-gz.out" 2> "$TMP/pull-gz.err"
[[ "$(cat "$TMP/pull-gz.out")" == "$PULLED_GZ" ]] || { echo "pull --source should cache the explicit key" >&2; exit 1; }
[[ "$(curl_downloads "$TMP/curl-pull-gz.log" "helium/$TOOL_VERSION/snapshot.tar.gz")" == "1" ]] \
  || { echo "pull --source should download the archive once" >&2; exit 1; }
assert_contains "$TMP/pull-gz.err" "A restore of --source $GZ_URI"
echo "stale" > "$NODE/.ethereumH/state/value"
FAKE_CURL_LOG="$TMP/curl-restore-gz.log" env "${PULL_ENV[@]}" "$TOOL" restore "$NODE" --source "$GZ_URI" --network helium --force \
  > "$TMP/restore-gz.out" 2> "$TMP/restore-gz.err"
assert_contains "$TMP/restore-gz.err" "reusing the cached archive"
[[ "$(curl_downloads "$TMP/curl-restore-gz.log" "helium/$TOOL_VERSION/snapshot.tar.gz")" == "0" ]] \
  || { echo "restore after pull should not download the archive again" >&2; cat "$TMP/curl-restore-gz.log" >&2; exit 1; }
assert_contains "$NODE/.ethereumH/state/value" "state-from-snapshot"
# The restore narrates each step.
for step in "\[1/7\] Restore plan" "\[2/7\] Fetching the archive" "\[3/7\] Extracting" "\[4/7\] Checking" \
            "\[5/7\] Replacing" "\[6/7\] Loading the public databases" "\[7/7\] Finalizing" "Snapshot restored into: $NODE"; do
  assert_contains "$TMP/restore-gz.err" "$step"
done

# A missing object (no sidecar, download fails) leaves nothing behind and does
# not prune the cache; a wrong published checksum discards the download.
if FAKE_CURL_LOG="$TMP/curl-pull-missing.log" env "${PULL_ENV[@]}" "$TOOL" pull --source "s3://strato-snapshots/helium/$TOOL_VERSION/missing.tar.zst" \
    > "$TMP/pull-missing.out" 2>&1; then
  echo "pull of a missing object should fail" >&2
  exit 1
fi
assert_contains "$TMP/pull-missing.out" "failed to download snapshot"
[[ ! -e "$PULL_DL/helium-$TOOL_VERSION-missing.tar.zst" && ! -e "$PULL_DL/helium-$TOOL_VERSION-missing.tar.zst.part" ]] \
  || { echo "a failed download must leave no archive or partial file" >&2; exit 1; }
assert_file "$PULLED_GZ"
cp "$TMP/snapshot.tar.gz" "$FAKE_BUCKET_DIR/badsum.tar.gz"
echo "0000000000000000000000000000000000000000000000000000000000000000  badsum.tar.gz" > "$FAKE_BUCKET_DIR/badsum.tar.gz.sha256"
if FAKE_CURL_LOG="$TMP/curl-pull-badsum.log" env "${PULL_ENV[@]}" "$TOOL" pull --source "s3://strato-snapshots/helium/$TOOL_VERSION/badsum.tar.gz" \
    > "$TMP/pull-badsum.out" 2>&1; then
  echo "pull with a checksum mismatch should fail" >&2
  exit 1
fi
assert_contains "$TMP/pull-badsum.out" "checksum mismatch"
[[ ! -e "$PULL_DL/helium-$TOOL_VERSION-badsum.tar.gz" && ! -e "$PULL_DL/helium-$TOOL_VERSION-badsum.tar.gz.part" ]] \
  || { echo "a download with a checksum mismatch must be discarded" >&2; exit 1; }

echo "strato-snapshot fixture tests passed"
