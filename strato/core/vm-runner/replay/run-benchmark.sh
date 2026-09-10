#!/usr/bin/env bash

set -euo pipefail

die() {
  echo "solidvm-replay: $*" >&2
  exit 1
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "missing environment variable: $name"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

check_hash() {
  local path="$1"
  local expected="$2"
  local description="$3"
  local actual
  actual="$(sha256_file "$path")"
  [[ "$actual" == "$expected" ]] ||
    die "$description SHA256 mismatch: expected=$expected actual=$actual"
}

check_snapshot_manifest() {
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$SNAPSHOT_DIR" && sha256sum -c "$SNAPSHOT_MANIFEST")
  else
    (cd "$SNAPSHOT_DIR" && shasum -a 256 -c "$SNAPSHOT_MANIFEST")
  fi
}

for name in \
  VM_REPLAY VM_REPLAY_SHA256 SOURCE_COMMIT BLOCKS BLOCKS_SHA256 GENESIS GENESIS_SHA256 \
  SNAPSHOT_DIR SNAPSHOT_MANIFEST SNAPSHOT_MANIFEST_SHA256 RUN_DIR \
  RESULT_DIR EXPECTED_SR_FILE EXPECTED_BLOCKS EXPECTED_FIRST EXPECTED_LAST \
  MIN_BLK_S LABEL NETWORK REDIS_CONTAINER REDIS_DB CHUNK_SIZE; do
  require_var "$name"
done

[[ "$REDIS_DB" == "3" ]] || die "REDIS_DB must be 3; DB 0 and DB 2 are forbidden"
[[ "$CHUNK_SIZE" =~ ^[1-9][0-9]*$ ]] || die "CHUNK_SIZE must be a positive integer"
[[ "$LABEL" != *[!A-Za-z0-9._-]* ]] || die "LABEL contains unsupported characters"
[[ -x "$VM_REPLAY" ]] || die "VM_REPLAY is not executable: $VM_REPLAY"
[[ -f "$BLOCKS" ]] || die "missing block file: $BLOCKS"
[[ -f "$GENESIS" ]] || die "missing genesis: $GENESIS"
[[ -d "$SNAPSHOT_DIR" ]] || die "missing snapshot directory: $SNAPSHOT_DIR"
[[ -f "$SNAPSHOT_MANIFEST" ]] || die "missing snapshot manifest: $SNAPSHOT_MANIFEST"
[[ -f "$EXPECTED_SR_FILE" ]] || die "missing expected-root file: $EXPECTED_SR_FILE"
[[ -f "$RUN_DIR/.solidvm-replay-run" ]] ||
  die "RUN_DIR is not marked for replay; create $RUN_DIR/.solidvm-replay-run intentionally"
[[ -f "$RUN_DIR/.ethereumH/ethconf.yaml" ]] ||
  die "RUN_DIR must contain a dedicated .ethereumH/ethconf.yaml"

case "$RUN_DIR" in
  /|/tmp|/private/tmp|"$HOME") die "unsafe RUN_DIR: $RUN_DIR" ;;
esac

if [[ -n "${FROM:-}" || -n "${TO:-}" ]]; then
  [[ -n "${FROM:-}" && -n "${TO:-}" ]] || die "FROM and TO must be set together"
fi

mkdir -p "$RESULT_DIR"
lock_dir="$RESULT_DIR/.solidvm-replay.lock"
mkdir "$lock_dir" 2>/dev/null || die "another replay wrapper owns $lock_dir"
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

if pgrep -x vm-replay >/dev/null || pgrep -x vm-runner >/dev/null; then
  die "another vm-replay or vm-runner is running"
fi

check_hash "$BLOCKS" "$BLOCKS_SHA256" "block file"
check_hash "$GENESIS" "$GENESIS_SHA256" "genesis"
check_hash "$VM_REPLAY" "$VM_REPLAY_SHA256" "vm-replay executable"
check_hash "$SNAPSHOT_MANIFEST" "$SNAPSHOT_MANIFEST_SHA256" "snapshot manifest"
check_snapshot_manifest >/dev/null

for namespace in state hash code blocksummarycachedb; do
  source_namespace="$SNAPSHOT_DIR/$namespace"
  target_namespace="$RUN_DIR/.ethereumH/$namespace"
  [[ -d "$source_namespace" ]] || die "snapshot is missing namespace: $namespace"
  rm -rf -- "$target_namespace"
  cp -a "$source_namespace" "$target_namespace"
done
cp -f "$GENESIS" "$RUN_DIR/genesis.json"

docker exec "$REDIS_CONTAINER" redis-cli -n "$REDIS_DB" FLUSHDB >/dev/null

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="$RESULT_DIR/$timestamp-$LABEL"
mkdir "$artifact_dir"

binary_sha="$(sha256_file "$VM_REPLAY")"
expected_sr="$(cat "$EXPECTED_SR_FILE")"
cat >"$artifact_dir/metadata.txt" <<EOF
label=$LABEL
timestamp=$timestamp
source_commit=$SOURCE_COMMIT
binary_sha256=$binary_sha
blocks_sha256=$BLOCKS_SHA256
genesis_sha256=$GENESIS_SHA256
snapshot_manifest_sha256=$SNAPSHOT_MANIFEST_SHA256
network=$NETWORK
redis_db=$REDIS_DB
chunk_size=$CHUNK_SIZE
from=${FROM:-full}
to=${TO:-full}
expected_blocks=$EXPECTED_BLOCKS
expected_first=$EXPECTED_FIRST
expected_last=$EXPECTED_LAST
minimum_blk_s=$MIN_BLK_S
ghcrts=${GHCRTS:-}
EOF

flags=(--network="$NETWORK" --sqlDiff=false --minLogLevel=LevelError)
apply_args=(apply-stream "$BLOCKS" "$CHUNK_SIZE")
audit_args=(audit "$BLOCKS")
if [[ -n "${FROM:-}" ]]; then
  apply_args+=("$FROM" "$TO")
  audit_args+=("$FROM" "$TO")
fi

export GHCRTS="${GHCRTS:--A256m -H1G}"
cd "$RUN_DIR"
set +e
"$VM_REPLAY" "${flags[@]}" "${apply_args[@]}" \
  >"$artifact_dir/apply.stdout" 2>"$artifact_dir/apply.stderr"
apply_rc=$?
set -e

result_line="$(grep -a $'^ok\t' "$artifact_dir/apply.stdout" | tail -1 || true)"
[[ $apply_rc -eq 0 && -n "$result_line" ]] ||
  die "apply failed: rc=$apply_rc artifacts=$artifact_dir"

IFS=$'\t' read -r status actual_blocks actual_first actual_last seconds rate actual_sr <<<"$result_line"
[[ "$status" == "ok" ]] || die "unexpected result status: $status"
[[ "$actual_blocks" == "$EXPECTED_BLOCKS" ]] || die "block count mismatch: $actual_blocks"
[[ "$actual_first" == "$EXPECTED_FIRST" ]] || die "first block mismatch: $actual_first"
[[ "$actual_last" == "$EXPECTED_LAST" ]] || die "last block mismatch: $actual_last"
[[ "$actual_sr" == "$expected_sr" ]] || die "final state root mismatch"
awk -v actual="$rate" -v minimum="$MIN_BLK_S" \
  'BEGIN { exit !(actual + 0 >= minimum + 0) }' ||
  die "performance floor missed: actual=$rate minimum=$MIN_BLK_S"

set +e
"$VM_REPLAY" "${flags[@]}" "${audit_args[@]}" \
  >"$artifact_dir/audit.stdout" 2>"$artifact_dir/audit.stderr"
audit_rc=$?
set -e

audit_line="$(grep -a 'AUDIT ok' "$artifact_dir/audit.stderr" | tail -1 || true)"
[[ $audit_rc -eq 0 && -n "$audit_line" ]] ||
  die "fresh-process audit failed: rc=$audit_rc artifacts=$artifact_dir"
grep -aF "$expected_sr" "$artifact_dir/audit.stderr" >/dev/null ||
  die "audit state root mismatch"

{
  printf 'result=%s\n' "$result_line"
  printf 'audit=%s\n' "$audit_line"
} >>"$artifact_dir/metadata.txt"

printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$timestamp" "$LABEL" "$SOURCE_COMMIT" "$binary_sha" "$result_line" "$audit_line" \
  >>"$RESULT_DIR/results.tsv"

chmod -R a-w "$artifact_dir"
printf '%s\n%s\n' "$result_line" "$audit_line"
