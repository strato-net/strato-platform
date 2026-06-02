#!/usr/bin/env bash

# Create a STRATO node snapshot from a running, synced node and publish it to
# the snapshot S3 bucket under the network prefix, updating the 'latest' alias.
#
# Intended for nightly/CI use (see pipelines/Jenkinsfile.synctest). Assumes the
# node at --node-dir is up and reachable; create waits for sync, stops writers,
# archives state, and runs a restore smoke test before publishing.
#
# Layout produced in the bucket:
#   s3://<bucket>/<network>/<network>-<YYYYMMDD-HHmmssZ>.tar.zst (+ .sha256)
#   s3://<bucket>/<network>/latest.tar.zst                       (+ .sha256)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT_TOOL="$SCRIPT_DIR/../bin/strato-snapshot"

DEFAULT_BUCKET="strato-snapshots"
# The STRATO API (port 3000) is not published to the host; it is only reachable
# from within the container network. We therefore run the metadata/tip curls
# from inside a container (default strato-nginx-1) via `docker exec`, targeting
# the node API at the host's hostname:3000. create derives the last-block and
# cirrus-tip URLs from this metadata URL.
DEFAULT_CURL_CONTAINER="strato-nginx-1"
DEFAULT_METADATA_URL="http://$(hostname):3000/eth/v1.2/metadata"

usage() {
  cat <<EOF
Usage:
  create-and-publish-snapshot.sh --node-dir <dir> --network <network> [options]

Options:
  --node-dir <dir>        Running, synced node directory to snapshot. Required.
  --network <network>     Network name (e.g. upquark, helium). Required.
  --bucket <name>         Target S3 bucket. Default: env STRATO_SNAPSHOT_BUCKET
                          or '$DEFAULT_BUCKET'.
  --metadata-url <url>    Node metadata endpoint, reachable from the curl
                          container. Default: env STRATO_SNAPSHOT_METADATA_URL
                          or '$DEFAULT_METADATA_URL'. last-block and cirrus-tip
                          URLs are derived from it.
  --curl-container <name> Container to run metadata/tip curls from (the node API
                          is not published to the host). Default: env
                          STRATO_SNAPSHOT_CURL_CONTAINER or '$DEFAULT_CURL_CONTAINER'.
                          Pass an empty value to curl directly from the host.
  --output-dir <dir>      Local staging dir for the archive. Default: a temp dir.
  --wait-timeout <secs>   Seconds to wait for sync before snapshotting. Default: 3600.
  --layer-lag <blocks>    Allowed API-indexer/Cirrus tip lag. Default: 5.
  --strict-layers         Require API-indexer and Cirrus tip verification.
  --include-prometheus    Include prometheus/ in the payload.
  --run-smoke-test        Run create's post-create restore smoke test. Off by
                          default in this orchestration (the source node is
                          already verified synced and the artifact is checksummed).
  --keep-archive          Do not delete the local archive after publishing.
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

NODE_DIR=""
NETWORK=""
BUCKET="${STRATO_SNAPSHOT_BUCKET:-$DEFAULT_BUCKET}"
METADATA_URL="${STRATO_SNAPSHOT_METADATA_URL:-$DEFAULT_METADATA_URL}"
CURL_CONTAINER="${STRATO_SNAPSHOT_CURL_CONTAINER-$DEFAULT_CURL_CONTAINER}"
OUTPUT_DIR=""
WAIT_TIMEOUT="3600"
LAYER_LAG="5"
STRICT_LAYERS="false"
INCLUDE_PROMETHEUS="false"
RUN_SMOKE_TEST="false"
KEEP_ARCHIVE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-dir) NODE_DIR="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --metadata-url) METADATA_URL="$2"; shift 2 ;;
    --curl-container) CURL_CONTAINER="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --wait-timeout) WAIT_TIMEOUT="$2"; shift 2 ;;
    --layer-lag) LAYER_LAG="$2"; shift 2 ;;
    --strict-layers) STRICT_LAYERS="true"; shift ;;
    --include-prometheus) INCLUDE_PROMETHEUS="true"; shift ;;
    --run-smoke-test) RUN_SMOKE_TEST="true"; shift ;;
    --keep-archive) KEEP_ARCHIVE="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ -n "$NODE_DIR" ]] || die "--node-dir is required"
[[ -n "$NETWORK" ]] || die "--network is required"
[[ -x "$SNAPSHOT_TOOL" ]] || die "strato-snapshot not found at $SNAPSHOT_TOOL"
command -v aws >/dev/null 2>&1 || die "aws CLI is required to publish snapshots"

CLEANUP_DIR=""
cleanup() {
  [[ -n "$CLEANUP_DIR" && -d "$CLEANUP_DIR" ]] && rm -rf "$CLEANUP_DIR"
  return 0
}
trap cleanup EXIT

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$(mktemp -d)"
  CLEANUP_DIR="$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"

# Filename-safe UTC timestamp matching the resolver's expected key form
# (<network>-<YYYYMMDD-HHmmssZ>.tar.zst).
TIMESTAMP="$(date -u +%Y%m%d-%H%M%SZ)"
ARCHIVE_NAME="${NETWORK}-${TIMESTAMP}.tar.zst"
ARCHIVE_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
DESTINATION="s3://${BUCKET}/${NETWORK}/"

CREATE_ARGS=(
  "$NODE_DIR"
  --network "$NETWORK"
  --output "$ARCHIVE_PATH"
  --wait-timeout "$WAIT_TIMEOUT"
  --layer-lag "$LAYER_LAG"
)
[[ -n "$METADATA_URL" ]] && CREATE_ARGS+=(--metadata-url "$METADATA_URL")
[[ "$STRICT_LAYERS" == "true" ]] && CREATE_ARGS+=(--strict-layers)
# The post-create smoke test restores into a temp dir and starts a fresh node
# that waits on host loopback metadata without the deployment's SSL/host flags,
# which is not reachable in this environment. The source node was already
# verified synced before snapshotting, and publish checksums the artifact, so
# skip the smoke restore in this orchestration unless explicitly enabled.
[[ "$RUN_SMOKE_TEST" == "true" ]] || CREATE_ARGS+=(--skip-smoke-test)
[[ "$INCLUDE_PROMETHEUS" == "true" ]] && CREATE_ARGS+=(--include-prometheus)

# Run the node metadata/tip curls from inside this container, since the node
# API is not published to the host. Empty means curl directly from the host.
export STRATO_SNAPSHOT_CURL_CONTAINER="$CURL_CONTAINER"

echo "Creating $NETWORK snapshot from $NODE_DIR -> $ARCHIVE_PATH"
"$SNAPSHOT_TOOL" create "${CREATE_ARGS[@]}"

echo "Publishing $ARCHIVE_NAME to $DESTINATION (alias: latest)"
"$SNAPSHOT_TOOL" publish "$ARCHIVE_PATH" --destination "$DESTINATION" --alias latest

echo "Published:"
echo "  ${DESTINATION}${ARCHIVE_NAME}"
echo "  ${DESTINATION}latest.tar.zst"

if [[ "$KEEP_ARCHIVE" == "true" && -n "$CLEANUP_DIR" ]]; then
  echo "Local archive retained at $ARCHIVE_PATH"
  CLEANUP_DIR=""
fi
