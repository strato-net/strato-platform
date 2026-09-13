# vm-query

Phase 5 stage 3 spike: vm-runner's JSON-RPC handlers over the SQL state
mirror instead of the trie. See `design-documents/rpc-decoupling.md` for
the findings.

```
vm-query seed                       migrate the eth tables and insert the sample contract
vm-query selector "total(uint256)"  4-byte selector for a signature
vm-query call <to> <data> [n]       eth_call n times: result, SQL round trips, latency
vm-query parity <to> <data>         the same call on the in-memory VM fed the same rows
```

`spike/run-spike.sh` does all of it against a throwaway Postgres in Docker.
Postgres comes from `ethconf.yaml` (`$STRATO_CONF`), as for every process.

`vm-query serve` reads through `sqlReaderConfig` when ethconf sets one
(the API-role container does, from `postgres_reader_host`), else through
`sqlConfig`; `/health` says which as `sqlEndpoint`. A snapshot transaction
the reader cancels or drops is replaced on the spot and the command that
hit it is retried once (`outcome="mirror_failure"` in the request counter).

Prefetch: a contract with at most `--prefetchMaxRows` (4096) storage rows
is read whole on first touch in an epoch, larger ones slot by slot until a
context has read `--prefetchAfterSlots` (64) of them, then whole up to the
cache cap. Metrics `vm_query_prefetch_rows`, `_declined_total`,
`_promoted_total`. `spike/run-prefetch-bench.sh` is where the numbers
behind the defaults come from; the mirror needs the
`(address_state_ref_id, key)` index `indexAll` now creates.

Live follower: `STRATO_CONF=<ethconf reaching the follower eth db> \
NODE=https://app.testnet.strato.nexus spike/run-follower-parity.sh`, for
example with `ssh -N -L 55440:127.0.0.1:5432 testnet-node-app-a` and an
ethconf whose sqlConfig is 127.0.0.1:55440 (the role needs SELECT on
address_state_ref, storage, code_ref, block_data_ref).
