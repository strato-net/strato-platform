# Slipstream throughput benchmark

The benchmark answers one question: can Slipstream consume `vmevents` faster
than the VM produces them, while producing the same Cirrus state?

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
full-sync confirmation below.

## Real VM-event replay benchmark

`bench/vmevents-replay/run.sh` is the separate processor-plus-database
benchmark. It captures real `vmevents` with their Kafka batch boundaries, links
one replay binary against unchanged baseline code and another against the
candidate, initializes fresh databases, times both on identical input, and
compares every output table's row count and business-content hash.

```sh
BASELINE_STRATO_DIR=/path/to/baseline/strato \
  ./bench/vmevents-replay/run.sh
```

See `bench/vmevents-replay/README.md` for scope, controls, and overrides. Kafka
capture is outside the stopwatch, so compare its events/second with live
producer and committed-consumer offsets; do not present it as terminal-lag-zero
proof.

For a separately isolated end-to-end drain measurement, use
`bench/vmevents-replay/run-kafka.sh`. Its timer includes consumption and the
final offset commit; the script also asserts broker-reported terminal lag zero
and verifies candidate database hashes against the baseline replay.

The candidate's batching bounds and SQL-error classification have focused
regression coverage:

```sh
stack test slipstream:slipstream-batching-test --fast --jobs 2
```

## Signals

Sample these every 15 seconds:

- VM producer position: the `vmevents` partition log-end offset.
- Slipstream position: the `slipstream` consumer group's committed offset.
- Slipstream lag: log-end offset minus committed offset.
- VM and sequencer block tips, for end-to-end context.
- `slipstream_kafka_batch_size`.
- `slipstream_kafka_read` and `slipstream_kafka_processed`; their difference is
  the in-process batch, while Kafka committed lag remains the durable measure.
- `slipstream_output_batch_size{kind="cirrus_query"}` and
  `slipstream_output_batch_size{kind="transaction_result"}`.
- `slipstream_phase_seconds{phase="batch"}`, `transform`, `cirrus`, and
  `transaction_results`.
- Slipstream CPU/RSS and PostgreSQL transaction, statement, and WAL rates.

Kafka offsets are the primary throughput measure because a single block can
produce different numbers of VM events. Block heights alone can make workloads
with different event densities look equivalent.

## Controlled replay

1. Capture a fixed range of `vmevents` from a completed sync by explicit topic,
   partition, and offsets. Do not consume through the `slipstream` group.
2. Start a fresh PostgreSQL database and fresh Kafka state for every run.
3. Replay the identical range into the baseline and candidate builds, one run at
   a time on the same host.
4. Run each build at least three times, alternating their order. Report the
   median and the individual runs.
5. Record elapsed time to terminal consumer lag zero, sustained events/second,
   peak lag, lag-drain rate after replay ends, CPU, RSS, SQL error count, and the
   phase-duration metrics.

Use a range containing contract creation, storage and mapping updates, events,
event arrays, and transaction results. Include a second replay of the same
range against the populated database; this exercises recovery and idempotency.

## Full-sync confirmation

After controlled replay passes, run baseline and candidate from clean node data
against the same fixed chain target. Use the same source revision, build flags,
genesis, bootnodes, database resources, and host. Never run the two candidates
concurrently. Report:

- time for the VM to reach the target;
- time for Slipstream to commit the corresponding final `vmevents` offset;
- the lag time between those milestones;
- median steady-state producer and consumer rates;
- peak and terminal Slipstream lag.

## Correctness gates

A throughput result is valid only when all of these hold:

- the candidate commits the final input offset and ends at zero lag;
- no unexpected PostgreSQL or decode errors occur;
- baseline and candidate have the same row counts and deterministic row hashes
  for `event`, `event@array`, `contract`, storage, mapping, and representative
  application tables;
- history tables have exactly one open interval per logical key, no overlapping
  intervals, and the same rows and validity bounds in both runs;
- transaction-result counts and statuses match;
- the VM state root and block output are unchanged.

## Success criterion

The candidate should sustain at least 20% more `vmevents` per second than the
VM's peak one-minute production rate, end at zero lag, and pass every correctness
gate. If it does not, use `slipstream_phase_seconds` to choose the next target:
transform CPU, Cirrus SQL, or transaction-result insertion.
