#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STRATO_DIR=${STRATO_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)}
STATEMENT_COUNT=${STATEMENT_COUNT:-400}
PAYLOAD_BYTES=${PAYLOAD_BYTES:-262144}
PG_PORT=${PG_PORT:-55457}
BENCH_ROOT=${BENCH_ROOT:-$(mktemp -d /private/tmp/slipstream-statement-cache.XXXXXX)}
PG_DATA="$BENCH_ROOT/postgres"
BIN_DIR="$BENCH_ROOT/bin"
PG_STARTED=0

cleanup() {
  if [ "$PG_STARTED" -eq 1 ]; then
    pg_ctl -D "$PG_DATA" -m fast -w stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$BIN_DIR" "$BENCH_ROOT/ghc"
(
  cd "$STRATO_DIR"
  stack ghc -- -O2 -rtsopts -with-rtsopts=-T \
    -odir "$BENCH_ROOT/ghc" \
    -hidir "$BENCH_ROOT/ghc" \
    "$SCRIPT_DIR/Retention.hs" \
    -o "$BIN_DIR/statement-cache-retention"
)

initdb -D "$PG_DATA" --no-locale --encoding=UTF8 --auth=trust --username=postgres >/dev/null
pg_ctl -D "$PG_DATA" -l "$BENCH_ROOT/postgres.log" \
  -o "-h 127.0.0.1 -p $PG_PORT" -w start >/dev/null
PG_STARTED=1
createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres cache_probe

/usr/bin/time -l "$BIN_DIR/statement-cache-retention" \
  "host=127.0.0.1 port=$PG_PORT user=postgres dbname=cache_probe" \
  "$STATEMENT_COUNT" "$PAYLOAD_BYTES" +RTS -T -s -RTS \
  2>&1 | tee "$BENCH_ROOT/result.txt"

echo "artifacts=$BENCH_ROOT"
