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
echo; echo "== at(7) : one mapping slot"
$BIN call $TO "$AT$(word 7)" 20
for n in 1 16 64 256; do
  echo; echo "== total($n) : $n mapping slots in one call"
  $BIN call $TO "$TOTAL$(word $n)" 10
done
echo; echo "== parity: total(64) on the SQL VM vs the in-memory VM"
$BIN parity $TO "$TOTAL$(word 64)"

echo; echo "== service: the wire exchange ethereum-jsonrpc makes"
$BIN serve --port=58546 > $WORK/serve.log 2>&1 &
SERVE_PID=$!
for i in $(seq 1 50); do curl -sf http://127.0.0.1:58546/health >/dev/null 2>&1 && break; sleep 0.2; done
echo "health: $(curl -s http://127.0.0.1:58546/health)"
$BIN client http://127.0.0.1:58546 $TO "$TOTAL$(word 64)"
$BIN client http://127.0.0.1:58546 $TO "$AT$(word 7)"
# 200 sequential calls through the service, wall clock
t0=$(date +%s.%N)
for i in $(seq 1 200); do $BIN client http://127.0.0.1:58546 $TO "$GET" > /dev/null; done
t1=$(date +%s.%N)
echo "200 client round trips (process spawn included): $(echo "($t1 - $t0) * 1000 / 200" | bc -l | cut -c1-6) ms each"
echo "metrics: $(curl -s http://127.0.0.1:58546/metrics | grep -E '^vm_query_requests_total' | tr '\n' ' ')"
curl -s http://127.0.0.1:58546/metrics | grep -E '^vm_query_command_seconds_(sum|count)' | awk '{v[$1]=$2} END {for (k in v) if (k ~ /_sum/) s=v[k]; else c=v[k]; printf "in-service mean per command: %.2f ms over %d commands\n", 1000*s/c, c}'
kill $SERVE_PID 2>/dev/null || true

docker rm -f $NAME >/dev/null
rm -rf $WORK
