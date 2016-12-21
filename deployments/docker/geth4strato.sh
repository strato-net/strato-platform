#!/bin/bash

set -e
[[ -n "$1" ]] || echo >&2 "Must pass a boot node IP address for your Strato node." && exit 1
stratoIP=$1

case $2 in
  )
    initDiff=1024
    ;;
  10k)
    initDiff=10000
    ;;
  100k)
    initDiff=100000
    ;;
  1M)
    initDiff=1000000
    ;;
  10M)
    initDiff=10000000
    ;;
  *)
    echo >&2 "Initial difficulty mode must be one of 10k, 100k, 1M, 10M if present"
    exit 1
    ;;
esac

rm -rf ~/.ethereumH ~/.ethash

cat >genesis.json <<EOF
{
  "nonce": "0x42",
  "timestamp": "0x0",
  "parentHash": "0x0",
  "extraData": "0x11bbe8db4e347b4e8c937c1c8370e4b5ed33adb3db69cbdb7a38e1e50b1b82fa",
  "gasLimit": "0x8000000000000",
  "difficulty": "$initDiff",
  "mixHash": "0x0",
  "coinbase": "0",
  "alloc": {
    "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859" : {
      "balance": "1809251394333065553493296640760748560207343510400633813116524750123642650624]"
    }
  }
}
EOF

geth init genesis.json

exec geth --networkid=6 --nat none --bootnodes --mine --etherbase af8b2d3fe28201476fc0a3961f8f9690693f3ef4 \
  enode://adaa44c0168b42da42b5eb51e6fd7e203978cf7789ac41bda28f7ea3e92f54bec7276cd704335e2c089d02e09ea77710340a1624febabedd87866c9d01cba341@$stratoIP:30303 
 
