# Slipstream SQL batching benchmark

## Standalone SQL batching benchmark

`bench/pg-batching/run.sh` is an independent microbenchmark for the database
write pattern changed by the batching optimization. It creates a temporary
PostgreSQL cluster, compares one duplicate event per transaction with one
multi-row duplicate event insert, reports alternating-run medians, and removes
the cluster afterward. It does not connect to Docker or the running node.

Run it from this directory:

```sh
./bench/pg-batching/run.sh
```

The workload can be adjusted without editing the script:

```sh
ROWS=2718 RUNS=5 SECONDS_PER_RUN=3 ./bench/pg-batching/run.sh
```

This benchmark isolates SQL transaction and round-trip overhead. It is useful
for detecting regressions, but it does not replace the controlled replay and
full-sync correctness checks.
