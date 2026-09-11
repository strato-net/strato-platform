#!/usr/bin/env bash
# The vm-query spike, end to end on a laptop: a throwaway Postgres, the eth
# tables migrated and seeded with the sample contract, then eth_call through
# the SQL-backed VM with cold and warm timings and SQL round-trip counts,
# and a parity check against the in-memory VM fed the same rows.
set -euo pipefail
cd "$(dirname "$0")/../../.."
BIN=$(stack path --local-install-root)/bin/vm-query
PORT=${PG_PORT:-55434}
NAME=vmquery-pg
WORK=$(mktemp -d)

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --rm --name $NAME -e POSTGRES_PASSWORD=pw -p $PORT:5432 postgres:14-alpine >/dev/null
for i in $(seq 1 30); do docker exec $NAME pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec $NAME psql -U postgres -qc "CREATE DATABASE eth;"

# A minimal ethconf pointing at it (everything else defaults).
mkdir -p $WORK/.ethereumH
cat > $WORK/.ethereumH/ethconf.yaml <<YAML
sqlConfig: {user: postgres, password: pw, host: 127.0.0.1, port: $PORT, database: eth, poolsize: 4}
# The same database under another host spelling, so the reader pool is a
# distinct pool as on an API-role node (where it is the replica endpoint).
sqlReaderConfig: {user: postgres, password: pw, host: localhost, port: $PORT, database: eth, poolsize: 4}
cirrusConfig: {user: postgres, password: pw, host: 127.0.0.1, port: $PORT, database: cirrus, poolsize: 4}
redisBlockDBConfig: {redisHost: 127.0.0.1, redisPort: 6379, redisAuth: null, redisDBNumber: 0, redisMaxConnections: 4, redisMaxIdleTime: 30}
discoveryConfig: {discoveryPort: 30303, minAvailablePeers: 1}
apiConfig: {}
YAML
export STRATO_CONF=$WORK/.ethereumH/ethconf.yaml

TO=0xc0ffee0000000000000000000000000000000001
$BIN seed
GET=$($BIN selector "get()")
AT=$($BIN selector "at(uint256)")
TOTAL=$($BIN selector "total(uint256)")
word() { printf '%064x' "$1"; }

echo; echo "== get() : one scalar slot"
$BIN call $TO $GET 20
echo; echo "== get() with the service's per-request reset"
VMQ_CALL_MODE=service $BIN call $TO $GET 20 | tail -1
echo; echo "== at(7) : one mapping slot"
$BIN call $TO "$AT$(word 7)" 20
for n in 1 16 64 256; do
  echo; echo "== total($n) : $n mapping slots in one call"
  $BIN call $TO "$TOTAL$(word $n)" 10
done
# Promotion: a contract above the prefetch threshold is read slot by slot
# until one epoch has read 32 of its slots, then prefetched whole. The
# first call pays the account row, 32 slots and one prefetch; the second
# nothing.
echo; echo "== promotion: threshold 100 rows, prefetch after 32 slot reads, total(64) twice"
VMQ_CALL_MODE=service $BIN call $TO "$TOTAL$(word 64)" 2 --prefetchMaxRows=100 --prefetchAfterSlots=32 | grep -E "^call [12]:"
echo "== no promotion: the same with promotion off"
VMQ_CALL_MODE=service $BIN call $TO "$TOTAL$(word 64)" 2 --prefetchMaxRows=100 --prefetchAfterSlots=0 | grep -E "^call [12]:"
echo; echo "== parity: total(64) on the SQL VM vs the in-memory VM"
$BIN parity $TO "$TOTAL$(word 64)"

echo; echo "== service: the wire exchange ethereum-jsonrpc makes"
VM_QUERY_TIMING=1 $BIN serve --port=58546 ${SERVE_RTS:-} > $WORK/serve.log 2>&1 &
SERVE_PID=$!
for i in $(seq 1 50); do curl -sf http://127.0.0.1:58546/health >/dev/null 2>&1 && break; sleep 0.2; done
echo "health: $(curl -s http://127.0.0.1:58546/health)"
$BIN client http://127.0.0.1:58546 $TO "$TOTAL$(word 64)"
$BIN client http://127.0.0.1:58546 $TO "$AT$(word 7)"
# 200 calls back to back over one keep-alive connection: the service's
# steady-state cost, including the HTTP hop
$BIN client http://127.0.0.1:58546 $TO "$GET" 200 | tail -1
echo "metrics: $(curl -s http://127.0.0.1:58546/metrics | grep -E '^vm_query_requests_total' | tr '\n' ' ')"
curl -s http://127.0.0.1:58546/metrics | grep -E '^vm_query_command_seconds_(sum|count)' | awk '{v[$1]=$2} END {for (k in v) if (k ~ /_sum/) s=v[k]; else c=v[k]; printf "in-service mean per command: %.2f ms over %d commands\n", 1000*s/c, c}'
echo "server timing (last 3):"; grep '^timing' $WORK/serve.log | tail -3
# Advance the mirror by one block: the epoch must rotate, the caches drop,
# and the next call pays its queries again on the new snapshot.
docker exec $NAME psql -U postgres -d eth -qc "INSERT INTO block_data_ref (parent_hash, uncles_hash, coinbase, state_root, transactions_root, receipts_root, log_bloom, difficulty, number, gas_limit, gas_used, timestamp, extra_data, nonce, mix_hash, hash, pow_verified, is_confirmed, version) SELECT hash, uncles_hash, coinbase, state_root, transactions_root, receipts_root, log_bloom, 0, 2, gas_limit, 0, now(), extra_data, 0, mix_hash, repeat('02', 32), true, true, 3 FROM block_data_ref WHERE number = 1;"
sleep 1.3
echo "after advancing the mirror: $(curl -s http://127.0.0.1:58546/health | python3 -c 'import json,sys; d=json.load(sys.stdin); print("bestBlock", d["bestBlock"], "snapshotAgeSeconds %.3f" % d["snapshotAgeSeconds"])')"
$BIN client http://127.0.0.1:58546 $TO "$GET" 3 | tail -1
echo "server timing after rotation (last 3):"; grep '^timing' $WORK/serve.log | tail -3
# A reader endpoint cancels a snapshot transaction that conflicts with
# replay (or drops it on failover): terminate the epoch's backend and the
# next call must still answer, on a fresh epoch, with one logged retry.
docker exec $NAME psql -U postgres -d eth -qtc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'eth' AND state = 'idle in transaction';" | grep -c t | xargs echo "terminated snapshot backends:"
# (A warm call never touches the connection; an unknown account does.)
$BIN client http://127.0.0.1:58546 0xc0ffee0000000000000000000000000000000002 "$GET" 1 | head -1
echo "recovery: $(grep -c 'reopening the snapshot' $WORK/serve.log) retry logged; $(curl -s http://127.0.0.1:58546/metrics | grep -E '^vm_query_requests_total.*mirror_failure' | tr '\n' ' ')"
echo "health: $(curl -s http://127.0.0.1:58546/health | python3 -c 'import json,sys; d=json.load(sys.stdin); print("sqlEndpoint", d["sqlEndpoint"], "snapshotAgeSeconds %.3f" % d["snapshotAgeSeconds"])')"
grep '^vm-query: epoch' $WORK/serve.log
kill $SERVE_PID 2>/dev/null || true; sleep 0.3
# A cap smaller than the sample contract: every prefetch overflows it, the
# cache is dropped and refilled, results stay right, and the eviction
# counter says so.
echo; echo "== cap check: --cacheMaxRows=100 with a 257-row contract"
$BIN serve --port=58547 --cacheMaxRows=100 > $WORK/serve-cap.log 2>&1 &
CAP_PID=$!
for i in $(seq 1 50); do curl -sf http://127.0.0.1:58547/health >/dev/null 2>&1 && break; sleep 0.2; done
$BIN client http://127.0.0.1:58547 $TO "$TOTAL$(word 64)" 20 | head -2
echo "metrics: $(curl -s http://127.0.0.1:58547/metrics | grep -E '^vm_query_cache_(evictions_total|rows)' | tr '\n' ' ')"
kill $CAP_PID 2>/dev/null || true; sleep 0.3
# A cap smaller than the slots one call touches: the cache is dropped and
# refilled inside the call, the result is still right, and evictions count.
echo; echo "== cap check: --cacheMaxRows=30 with a call touching 64 slots"
$BIN serve --port=58548 --cacheMaxRows=30 > $WORK/serve-cap2.log 2>&1 &
CAP2_PID=$!
for i in $(seq 1 50); do curl -sf http://127.0.0.1:58548/health >/dev/null 2>&1 && break; sleep 0.2; done
$BIN client http://127.0.0.1:58548 $TO "$TOTAL$(word 64)" 5 | head -2
echo "metrics: $(curl -s http://127.0.0.1:58548/metrics | grep -E '^vm_query_cache_(evictions_total|rows)' | tr '\n' ' ')"
kill $CAP2_PID 2>/dev/null || true
kill $SERVE_PID 2>/dev/null || true

docker rm -f $NAME >/dev/null
rm -rf $WORK
