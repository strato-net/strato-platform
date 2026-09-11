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
