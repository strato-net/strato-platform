#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CANDIDATE_STRATO_DIR=${CANDIDATE_STRATO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)}
: "${BASELINE_STRATO_DIR:?Set BASELINE_STRATO_DIR to an unchanged STRATO checkout}"

KAFKA_HOST=${KAFKA_HOST:-127.0.0.1}
KAFKA_PORT=${KAFKA_PORT:-9092}
SKIP=${SKIP:-50000}
COUNT=${COUNT:-20000}
PG_PORT=${PG_PORT:-55451}
ORDER=${ORDER:-candidate-first}
BENCH_ROOT=${BENCH_ROOT:-$(mktemp -d /private/tmp/slipstream-vmevents-replay.XXXXXX)}

BIN_DIR="$BENCH_ROOT/bin"
PG_DATA="$BENCH_ROOT/postgres"
CORPUS="$BENCH_ROOT/vmevents-$COUNT-batched.bin"
PG_STARTED=0

cleanup() {
  if [ "$PG_STARTED" -eq 1 ]; then
    pg_ctl -D "$PG_DATA" -m fast -w stop >/dev/null
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$BIN_DIR" \
  "$BENCH_ROOT/ghc-capture" \
  "$BENCH_ROOT/ghc-baseline" \
  "$BENCH_ROOT/ghc-candidate"

(
  cd "$CANDIDATE_STRATO_DIR"
  stack ghc -- -O2 \
    -odir "$BENCH_ROOT/ghc-capture" \
    -hidir "$BENCH_ROOT/ghc-capture" \
    "$SCRIPT_DIR/Capture.hs" \
    -o "$BIN_DIR/capture-vmevents"
  stack ghc -- -O2 \
    -odir "$BENCH_ROOT/ghc-candidate" \
    -hidir "$BENCH_ROOT/ghc-candidate" \
    "$SCRIPT_DIR/ReplayCandidate.hs" \
    -o "$BIN_DIR/replay-candidate"
)

(
  cd "$BASELINE_STRATO_DIR"
  stack ghc -- -O2 \
    -odir "$BENCH_ROOT/ghc-baseline" \
    -hidir "$BENCH_ROOT/ghc-baseline" \
    "$SCRIPT_DIR/ReplayBaseline.hs" \
    -o "$BIN_DIR/replay-baseline"
)

CAPTURE_GROUP="slipstream-benchmark-$(date +%s)"
"$BIN_DIR/capture-vmevents" \
  "$KAFKA_HOST" "$KAFKA_PORT" "$CAPTURE_GROUP" \
  "$SKIP" "$COUNT" "$CORPUS"
shasum -a 256 "$CORPUS"

initdb -D "$PG_DATA" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$PG_DATA" -l "$BENCH_ROOT/postgres.log" \
  -o "-h 127.0.0.1 -p $PG_PORT" -w start >/dev/null
PG_STARTED=1

createuser -h 127.0.0.1 -p "$PG_PORT" -s postgres
for database in cirrus_baseline eth_baseline cirrus_candidate eth_candidate; do
  createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres "$database"
done

export PGOPTIONS='-c client_min_messages=warning'

run_baseline() {
  "$BIN_DIR/replay-baseline" "$CORPUS" \
    "host=127.0.0.1 port=$PG_PORT user=postgres dbname=cirrus_baseline" \
    "host=127.0.0.1 port=$PG_PORT user=postgres dbname=eth_baseline" \
    "$BENCH_ROOT/baseline.log"
}

run_candidate() {
  "$BIN_DIR/replay-candidate" "$CORPUS" \
    "host=127.0.0.1 port=$PG_PORT user=postgres dbname=cirrus_candidate" \
    "host=127.0.0.1 port=$PG_PORT user=postgres dbname=eth_candidate" \
    "$BENCH_ROOT/candidate.log"
}

case "$ORDER" in
  baseline-first)
    run_baseline
    run_candidate
    ;;
  candidate-first)
    run_candidate
    run_baseline
    ;;
  *)
    echo "ORDER must be baseline-first or candidate-first" >&2
    exit 2
    ;;
esac

for database in cirrus_baseline cirrus_candidate eth_baseline eth_candidate; do
  psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$database" \
    -v ON_ERROR_STOP=1 -At -f "$SCRIPT_DIR/HashTables.sql" \
    -o "$BENCH_ROOT/$database.hashes"
done

diff -u "$BENCH_ROOT/cirrus_baseline.hashes" "$BENCH_ROOT/cirrus_candidate.hashes"
diff -u "$BENCH_ROOT/eth_baseline.hashes" "$BENCH_ROOT/eth_candidate.hashes"

echo "correctness=matching_table_counts_and_business_hashes"
echo "artifacts=$BENCH_ROOT"
