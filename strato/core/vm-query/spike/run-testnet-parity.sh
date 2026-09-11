#!/usr/bin/env bash
# Parity against a real node: import the mirror rows of real contracts from
# the node's public read API into a throwaway Postgres, run eth_call on the
# query VM, run the same calls on the node's JSON-RPC (the trie-backed
# consensus VM), and compare. The node moves on between import and call, so
# a mismatch is re-checked against the block numbers before it counts.
#
#   NODE=https://app.testnet.strato.nexus ./run-testnet-parity.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
BIN=$(stack path --local-install-root)/bin/vm-query
NODE=${NODE:-https://app.testnet.strato.nexus}
PORT=${PG_PORT:-55435}
NAME=vmquery-parity-pg
WORK=$(mktemp -d)

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --rm --name $NAME -e POSTGRES_PASSWORD=pw -p $PORT:5432 postgres:14-alpine >/dev/null
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

# Real contracts on the network: the price oracle (a proxy), a token, and
# the native token. Addresses are the node's; the importer follows proxies.
ORACLE=${ORACLE:-0000000000000000000000000000000000001002}
TOKEN=${TOKEN:-000000000000000000000000000000000000100f}
NATIVE=${NATIVE:-937efa7e3a77e20bbdbd7c0d32b6514f368c1010}
HOLDER=${HOLDER:-0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82}
# Non-zero rows (as of block 543173): a priced asset, a funded token holder,
# and a funded native holder, so the check is not only of zero words.
PRICED=${PRICED:-c6c3e9881665d53ae8c222e24ca7a8d069aa56ca}
TOKEN_HOLDER=${TOKEN_HOLDER:-167346ac7ee48e834a83e6b9d4912504632c25a3}
NATIVE_HOLDER=${NATIVE_HOLDER:-000000000000000000000000000000000000100d}

echo "== import from $NODE"
$BIN import "$NODE" $ORACLE $TOKEN $NATIVE
IMPORT_BLOCK=$(curl -s "$NODE/rpc" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))')

word() { printf '%064x' "$1"; }
addrword() { printf '%064s' "$1" | tr ' ' 0; }
sel() { $BIN selector "$1"; }

# (label, to, calldata)
CALLS=(
  "oracle.queueSize()|$ORACLE|$(sel 'queueSize()')"
  "oracle.exchangeRates(native)|$ORACLE|$(sel 'exchangeRates(address)')$(addrword $NATIVE)"
  "oracle.rebaseFactors(native)|$ORACLE|$(sel 'rebaseFactors(address)')$(addrword $NATIVE)"
  "oracle.exchangeRates(token)|$ORACLE|$(sel 'exchangeRates(address)')$(addrword $TOKEN)"
  "oracle.exchangeRates(priced)|$ORACLE|$(sel 'exchangeRates(address)')$(addrword $PRICED)"
  "oracle.rebaseFactors(priced)|$ORACLE|$(sel 'rebaseFactors(address)')$(addrword $PRICED)"
  "token.totalSupply()|$TOKEN|$(sel 'totalSupply()')"
  "token.balanceOf(funded)|$TOKEN|$(sel 'balanceOf(address)')$(addrword $TOKEN_HOLDER)"
  "native.balanceOf(funded)|$NATIVE|$(sel 'balanceOf(address)')$(addrword $NATIVE_HOLDER)"
  "token.decimals()|$TOKEN|$(sel 'decimals()')"
  "token.balanceOf(holder)|$TOKEN|$(sel 'balanceOf(address)')$(addrword $HOLDER)"
  "native.totalSupply()|$NATIVE|$(sel 'totalSupply()')"
  "native.balanceOf(holder)|$NATIVE|$(sel 'balanceOf(address)')$(addrword $HOLDER)"
  "native.balanceOf(oracle)|$NATIVE|$(sel 'balanceOf(address)')$(addrword $ORACLE)"
  "native.name()|$NATIVE|$(sel 'name()')"
  "native.symbol()|$NATIVE|$(sel 'symbol()')"
)

rpc_call() {
  curl -s -m 30 "$NODE/rpc" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"0x$1\",\"data\":\"$2\"},\"latest\"]}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("result") or "error: "+json.dumps(d.get("error")))'
}

echo; echo "== calls (query VM on imported rows at block ~$IMPORT_BLOCK vs node RPC now)"
ok=0; bad=0
for entry in "${CALLS[@]}"; do
  IFS='|' read -r label to data <<< "$entry"
  local_out=$($BIN call "$to" "$data" 1 2>/dev/null | sed -n 's/^result: \(.*\)  (empty.*/\1/p')
  rpc_out=$(rpc_call "$to" "$data")
  if [[ "$local_out" == "$rpc_out" ]]; then
    ok=$((ok+1)); printf "  ok   %-28s %s\n" "$label" "${local_out:0:66}"
  else
    bad=$((bad+1)); printf "  DIFF %-28s\n       vm-query: %s\n       node rpc: %s\n" "$label" "$local_out" "$rpc_out"
  fi
done
NOW_BLOCK=$(curl -s "$NODE/rpc" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))')
echo; echo "parity: $ok matched, $bad differed (imported at ~$IMPORT_BLOCK, node now at $NOW_BLOCK)"

docker rm -f $NAME >/dev/null
rm -rf $WORK
