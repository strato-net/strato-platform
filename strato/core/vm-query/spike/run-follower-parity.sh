#!/usr/bin/env bash
# Parity against a LIVE follower mirror: no import. STRATO_CONF must point
# at an ethconf whose sqlConfig reaches the follower's eth database (for
# example over `ssh -N -L 55440:127.0.0.1:5432 testnet-node-app-a`), with
# read access to address_state_ref, storage, code_ref and block_data_ref.
# Every call runs on the query VM against that mirror and on the node's
# JSON-RPC (the trie-backed consensus VM), and the outputs are compared.
# The mirror trails the node by whatever the follower's indexer lags, so a
# mismatch is re-checked against the block numbers before it counts.
#
#   STRATO_CONF=~/follower/.ethereumH/ethconf.yaml \
#   NODE=https://app.testnet.strato.nexus ./run-follower-parity.sh
set -euo pipefail
cd "$(dirname "$0")/../../.." 2>/dev/null || true
BIN=${VMQ_BIN:-$(stack path --local-install-root)/bin/vm-query}
NODE=${NODE:-https://app.testnet.strato.nexus}
: "${STRATO_CONF:?set STRATO_CONF to an ethconf reaching the follower mirror}"
PORT=${VMQ_PORT:-58550}

ORACLE=${ORACLE:-0000000000000000000000000000000000001002}
TOKEN=${TOKEN:-000000000000000000000000000000000000100f}
NATIVE=${NATIVE:-937efa7e3a77e20bbdbd7c0d32b6514f368c1010}
HOLDER=${HOLDER:-0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82}
PRICED=${PRICED:-c6c3e9881665d53ae8c222e24ca7a8d069aa56ca}
TOKEN_HOLDER=${TOKEN_HOLDER:-167346ac7ee48e834a83e6b9d4912504632c25a3}
NATIVE_HOLDER=${NATIVE_HOLDER:-000000000000000000000000000000000000100d}

word() { printf '%064x' "$1"; }
addrword() { printf '%064s' "$1" | tr ' ' 0; }
sel() { $BIN selector "$1"; }
rpc() { curl -s -m 30 "$NODE/rpc" -H 'content-type: application/json' -d "$1"; }
node_block() { rpc '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c 'import json,sys; print(int(json.load(sys.stdin)["result"],16))'; }
rpc_call() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"0x$1\",\"data\":\"$2\"},\"latest\"]}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("result") or "error: "+json.dumps(d.get("error")))'
}

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

echo "== service on the follower's mirror"
$BIN serve --port=$PORT ${SERVE_FLAGS:-} > /tmp/vm-query-follower.log 2>&1 &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null || true' EXIT
for i in $(seq 1 100); do curl -sf http://127.0.0.1:$PORT/health >/dev/null 2>&1 && break; sleep 0.3; done
curl -sf http://127.0.0.1:$PORT/health || { echo "service did not come up:"; tail -5 /tmp/vm-query-follower.log; exit 1; }
echo; echo "node at block $(node_block)"

echo; echo "== calls: query VM on the live mirror vs node RPC (each twice: cold, then warm)"
ok=0; bad=0
for entry in "${CALLS[@]}"; do
  IFS='|' read -r label to data <<< "$entry"
  out=$($BIN client http://127.0.0.1:$PORT "$to" "$data" 2 | sed -n 's/^result: //p;s/^2 round trips over one connection: //p' | tr '\n' ' ')
  local_out=${out%% *}; timing=${out#* }
  rpc_out=$(rpc_call "$to" "$data")
  if [[ "$local_out" == "$rpc_out" ]]; then
    ok=$((ok+1)); printf "  ok   %-28s %s  (%s)\n" "$label" "${local_out:0:66}" "$timing"
  else
    bad=$((bad+1)); printf "  DIFF %-28s\n       vm-query: %s\n       node rpc: %s\n" "$label" "$local_out" "$rpc_out"
  fi
done
echo; echo "mirror: $(curl -s http://127.0.0.1:$PORT/health)"
echo "metrics: $(curl -s http://127.0.0.1:$PORT/metrics | grep -E '^vm_query_(requests_total|prefetch_(declined|promoted)_total|cache_rows)' | tr '\n' ' ')"
echo "parity: $ok matched, $bad differed (node now at $(node_block))"
