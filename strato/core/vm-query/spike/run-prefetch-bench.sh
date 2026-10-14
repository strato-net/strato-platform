#!/usr/bin/env bash
# Where the prefetch threshold comes from: the cost of reading a contract
# whole versus slot by slot, on a mirror-sized table (2M background rows
# over 20k contracts; testnet holds 2.27M rows) with one target contract
# grown from 256 to 262144 rows. Run first with the mirror's historical
# indexes (key only) and then with the (address_state_ref_id, key) index
# that indexAll now creates. Times are the call's time in SQL, cold.
#
#   ./run-prefetch-bench.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
BIN=$(stack path --local-install-root)/bin/vm-query
PORT=${PG_PORT:-55437}; NAME=vmquery-bench-pg; WORK=$(mktemp -d)
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --rm --name $NAME -e POSTGRES_PASSWORD=pw -p $PORT:5432 postgres:14-alpine -c shared_buffers=512MB >/dev/null
for i in $(seq 1 30); do docker exec $NAME pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec $NAME psql -U postgres -qc "CREATE DATABASE eth;"
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
$BIN seed >/dev/null 2>&1
GET=$($BIN selector 'get()'); AT=$($BIN selector 'at(uint256)'); TOTAL=$($BIN selector 'total(uint256)')
word() { printf '%064x' "$1"; }
psql_() { docker exec $NAME psql -U postgres -d eth -qtc "$1"; }
SID=$(psql_ "SELECT id FROM address_state_ref WHERE address = 'c0ffee0000000000000000000000000000000001';" | tr -d ' ')
echo "background: 20000 contracts x 100 rows"
psql_ "INSERT INTO address_state_ref (address, nonce, balance, contract_root, code_hash, contract_name, latest_block_data_ref_number) SELECT lpad(to_hex(g), 40, '0'), 0, 0, '', NULL, NULL, 1 FROM generate_series(1000000, 1019999) g;" >/dev/null
psql_ "INSERT INTO storage (address_state_ref_id, key, value) SELECT a.id, '_balances[' || lpad(to_hex(r), 40, '0') || ']', (r * 7)::text FROM address_state_ref a, generate_series(1, 100) r WHERE a.address LIKE '00000000000000000000000000000000000f%' OR a.id > $SID;" >/dev/null
# the seed applied indexAll; the first run measures without the composite index
psql_ "DROP INDEX IF EXISTS storage_address_state_ref_id_key_idx;" >/dev/null
sql() { sed -n 's/^call 1: \([0-9]*\) SQL round trips, [0-9.]* ms (\([0-9.]*\) ms in SQL).*/\2/p'; }
run() { # $1 index label
  printf "%-8s %8s %12s %12s %14s %16s\n" index rows "prefetch" "at(7)+pf" "at(7) slotwise" "total(64) slotwise"
  have=256
  for n in 256 1024 4096 16384 65536 262144; do
    if [ $n -gt $have ]; then
      psql_ "INSERT INTO storage (address_state_ref_id, key, value) SELECT $SID, 'm[' || g || ']', g::text FROM generate_series($have, $((n-1))) g;" >/dev/null
      have=$n
    fi
    psql_ "ANALYZE storage;" >/dev/null
    c1=$($BIN call $TO "$GET" 1 --prefetchMaxRows=1000000 2>/dev/null | sql)
    c2=$($BIN call $TO "$AT$(word 7)" 1 --prefetchMaxRows=1000000 2>/dev/null | sql)
    c3=$($BIN call $TO "$AT$(word 7)" 1 --prefetchMaxRows=0 2>/dev/null | sql)
    c4=$($BIN call $TO "$TOTAL$(word 64)" 1 --prefetchMaxRows=0 2>/dev/null | sql)
    printf "%-8s %8d %12s %12s %14s %16s\n" "$1" $n "$c1 ms" "$c2 ms" "$c3 ms" "$c4 ms"
  done
}
echo "rows: $(psql_ 'SELECT count(*) FROM storage;' | tr -d ' ')"
run "key"
psql_ "DELETE FROM storage WHERE address_state_ref_id = $SID AND key LIKE 'm[%' AND key <> 'm[7]' AND (substring(key from 3 for length(key)-3))::int >= 256;" >/dev/null
psql_ "CREATE INDEX storage_address_state_ref_id_key_idx ON storage (address_state_ref_id, key);" >/dev/null
echo "with (address_state_ref_id, key) index:"
run "sid,key"
docker rm -f $NAME >/dev/null; rm -rf $WORK
