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

make_fixture_snapshot() {
  local staging="$TMP/staging"
  mkdir -p "$staging/payload/ethereumH/state"
  mkdir -p "$staging/payload/postgres/base"
  mkdir -p "$staging/payload/redis"
  mkdir -p "$staging/payload/kafka/kafka-logs/__cluster_metadata-0"
  mkdir -p "$staging/payload/secrets"

  echo "state-from-snapshot" > "$staging/payload/ethereumH/state/value"
  echo "postgres-from-snapshot" > "$staging/payload/postgres/base/value"
  echo "redis-from-snapshot" > "$staging/payload/redis/appendonly.aof"
  echo "kafka-from-snapshot" > "$staging/payload/kafka/log"
  echo "snapshotpass" > "$staging/payload/secrets/postgres_password"

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
    "postgres",
    "redis",
    "kafka",
    "secrets/postgres_password"
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
assert_file "$NODE/postgres/base/value"
assert_file "$NODE/redis/appendonly.aof"
assert_file "$NODE/kafka/log"
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
assert_contains "$NODE/.ethereumH/ethconf.yaml" "password: snapshotpass"
assert_contains "$NODE/.ethereumH/ethconf.yaml" "host: 127.0.0.1"
if grep -q "host: localhost" "$NODE/.ethereumH/ethconf.yaml"; then
  echo "restore should rewrite local database hosts to 127.0.0.1" >&2
  exit 1
fi
assert_contains "$NODE/secrets/postgres_password" "snapshotpass"
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
echo "appledouble" > "$NODE/kafka/._log"
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
if tar -tzf "$CREATED" | grep -E '(^|/)\._' > "$TMP/created-appledouble.out"; then
  echo "created archive should not contain AppleDouble metadata" >&2
  cat "$TMP/created-appledouble.out" >&2
  exit 1
fi

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

PUBLISH="$TMP/published"
STRATO_SNAPSHOT_OFFLINE_TEST=1 "$TOOL" publish "$TMP/snapshot.tar.gz" --destination "$PUBLISH" --alias latest
assert_file "$PUBLISH/snapshot.tar.gz"
assert_file "$PUBLISH/snapshot.tar.gz.sha256"
assert_file "$PUBLISH/latest.tar.gz"
assert_file "$PUBLISH/latest.sha256"
assert_contains "$PUBLISH/latest.sha256" "latest.tar.gz"

FAKEBIN="$TMP/fakebin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/strato-setup" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$1/logs"
SH
cat > "$FAKEBIN/convoke" <<'SH'
#!/usr/bin/env bash
echo "fake convoke failed"
exit 42
SH
chmod +x "$FAKEBIN/strato-setup" "$FAKEBIN/convoke"
UP_NODE="$TMP/up-node"
mkdir -p "$UP_NODE"
if PATH="$FAKEBIN:$PATH" STRATO_UP_STARTUP_CHECK_SECONDS=1 "$ROOT/bin/strato-up" "$UP_NODE" > "$TMP/up.out" 2>&1; then
  echo "strato-up should reject immediate convoke failure" >&2
  exit 1
fi
assert_contains "$TMP/up.out" "convoke exited during startup"
[[ ! -f "$UP_NODE/.strato.pid" ]] || {
  echo "strato-up should remove pidfile after immediate convoke failure" >&2
  exit 1
}

echo "strato-snapshot fixture tests passed"
