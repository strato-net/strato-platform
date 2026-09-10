#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CANDIDATE_STRATO_DIR=${CANDIDATE_STRATO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)}
: "${CORPUS:?Set CORPUS to a captured vmevents-*-batched.bin file}"
: "${BASELINE_CIRRUS_HASHES:?Set BASELINE_CIRRUS_HASHES to the baseline Cirrus hash file}"
: "${BASELINE_ETH_HASHES:?Set BASELINE_ETH_HASHES to the baseline transaction-result hash file}"

KAFKA_PORT=${KAFKA_PORT:-29092}
PG_PORT=${PG_PORT:-55452}
KAFKA_IMAGE=${KAFKA_IMAGE:-apache/kafka:3.9.2}
BENCH_ROOT=${BENCH_ROOT:-$(mktemp -d /private/tmp/slipstream-vmevents-kafka.XXXXXX)}
KAFKA_CONTAINER="slipstream-vmevents-benchmark-$$"
TOPIC="vmevents-benchmark-$$"
GROUP="slipstream-benchmark-drain-$$"
PG_DATA="$BENCH_ROOT/postgres"
BIN_DIR="$BENCH_ROOT/bin"
PG_STARTED=0
KAFKA_STARTED=0

cleanup() {
  if [ "$KAFKA_STARTED" -eq 1 ]; then
    docker stop "$KAFKA_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ "$PG_STARTED" -eq 1 ]; then
    pg_ctl -D "$PG_DATA" -m fast -w stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$BIN_DIR" "$BENCH_ROOT/ghc-kafka"
(
  cd "$CANDIDATE_STRATO_DIR"
  stack ghc -- -O2 \
    -odir "$BENCH_ROOT/ghc-kafka" \
    -hidir "$BENCH_ROOT/ghc-kafka" \
    "$SCRIPT_DIR/KafkaReplayCandidate.hs" \
    -o "$BIN_DIR/kafka-replay-candidate"
)

initdb -D "$PG_DATA" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$PG_DATA" -l "$BENCH_ROOT/postgres.log" \
  -o "-h 127.0.0.1 -p $PG_PORT" -w start >/dev/null
PG_STARTED=1
createuser -h 127.0.0.1 -p "$PG_PORT" -s postgres
createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres cirrus_candidate
createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres eth_candidate

docker run -d --rm --name "$KAFKA_CONTAINER" \
  -p "127.0.0.1:$KAFKA_PORT:29092" \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS=INTERNAL://0.0.0.0:9092,EXTERNAL://0.0.0.0:29092,CONTROLLER://0.0.0.0:9093 \
  -e "KAFKA_ADVERTISED_LISTENERS=INTERNAL://localhost:9092,EXTERNAL://localhost:$KAFKA_PORT" \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=INTERNAL \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
  -e KAFKA_NUM_PARTITIONS=1 \
  -e KAFKA_MESSAGE_MAX_BYTES=104857600 \
  -e KAFKA_REPLICA_FETCH_MAX_BYTES=104857600 \
  "$KAFKA_IMAGE" >/dev/null
KAFKA_STARTED=1

ready=0
attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker exec "$KAFKA_CONTAINER" \
    /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list \
    >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "isolated Kafka broker did not become ready" >&2
  exit 1
fi

export PGOPTIONS='-c client_min_messages=warning'
"$BIN_DIR/kafka-replay-candidate" "$CORPUS" \
  127.0.0.1 "$KAFKA_PORT" "$TOPIC" "$GROUP" \
  "host=127.0.0.1 port=$PG_PORT user=postgres dbname=cirrus_candidate" \
  "host=127.0.0.1 port=$PG_PORT user=postgres dbname=eth_candidate" \
  "$BENCH_ROOT/candidate.log" >"$BENCH_ROOT/result.txt"
cat "$BENCH_ROOT/result.txt"

docker exec "$KAFKA_CONTAINER" \
  /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 --group "$GROUP" --describe \
  >"$BENCH_ROOT/kafka-offsets.txt"
cat "$BENCH_ROOT/kafka-offsets.txt"
printf '\n'
awk -v group="$GROUP" -v topic="$TOPIC" '
  $1 == group && $2 == topic {
    checked++
    if ($4 != $5 || $6 != 0) failed=1
  }
  END { exit (checked == 1 && !failed) ? 0 : 1 }
' "$BENCH_ROOT/kafka-offsets.txt"

for database in cirrus_candidate eth_candidate; do
  psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$database" \
    -v ON_ERROR_STOP=1 -At -f "$SCRIPT_DIR/HashTables.sql" \
    -o "$BENCH_ROOT/$database.hashes"
done
diff -u "$BASELINE_CIRRUS_HASHES" "$BENCH_ROOT/cirrus_candidate.hashes"
diff -u "$BASELINE_ETH_HASHES" "$BENCH_ROOT/eth_candidate.hashes"

shasum -a 256 "$CORPUS"
echo "terminal_kafka_lag=0"
echo "correctness=matching_baseline_table_counts_and_business_hashes"
echo "artifacts=$BENCH_ROOT"
