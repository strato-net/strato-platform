# VM-event replay benchmark

This benchmark captures real `vmevents` through a unique read-only Kafka
consumer group and preserves the broker's batch boundaries. It then replays the
same batches through unchanged and candidate Slipstream code into separate,
fresh PostgreSQL databases.

The timed region includes decoding/transform work, Cirrus writes,
transaction-result writes, and application logging. Schema migration and
corpus decoding happen before the stopwatch. Kafka capture is not timed, so
this is a processor-plus-database benchmark rather than a full consumer-lag
benchmark.

Run from the candidate STRATO checkout and point at an unchanged baseline:

```sh
BASELINE_STRATO_DIR=/path/to/baseline/strato ./indexer/slipstream/bench/vmevents-replay/run.sh
```

Defaults capture 20,000 events after skipping 50,000 and use localhost Kafka
and PostgreSQL port 55451. They can be overridden:

```sh
SKIP=50000 COUNT=20000 PG_PORT=55452 ORDER=baseline-first \
  BASELINE_STRATO_DIR=/path/to/baseline/strato \
  ./indexer/slipstream/bench/vmevents-replay/run.sh
```

Run at least three fresh trials, alternating `ORDER`, and report individual
times plus medians. The script stops only the PostgreSQL cluster it creates and
leaves its corpus, logs, hashes, and database files in the printed artifact
directory.

`HashTables.sql` checks every public table's row count and deterministic content
hash. It excludes only `event.id`, a non-key serial whose allocation order
changes under multi-row inserts; the event primary key and all business fields
remain included.

## End-to-end Kafka drain benchmark

`run-kafka.sh` is a separate candidate benchmark whose timed region starts
before Kafka consumption and ends after the final synchronous offset commit.
It creates and later stops its own localhost-only Kafka container and temporary
PostgreSQL cluster. It asserts broker-reported terminal lag zero and compares
the resulting databases with hash files from an unchanged baseline replay.

First retain the corpus and baseline hashes printed by `run.sh`, then run:

```sh
CORPUS=/path/to/vmevents-20000-batched.bin \
BASELINE_CIRRUS_HASHES=/path/to/cirrus_baseline.hashes \
BASELINE_ETH_HASHES=/path/to/eth_baseline.hashes \
  ./indexer/slipstream/bench/vmevents-replay/run-kafka.sh
```

The script defaults to host ports 29092 for Kafka and 55452 for PostgreSQL;
override them with `KAFKA_PORT` and `PG_PORT` if needed. Its Kafka topic,
consumer group, container, databases, and PostgreSQL data directory are fresh
for every run. It never uses or stops the node's stock services.

See `RESULTS-2026-08-26.md` for the reference run, phase diagnosis, three-run
medians, end-to-end offset proof, and correctness evidence.

## Candidate safety checks

The production path streams de-duplicated generated outputs through a buffer of
at most 256 items, splits multi-row inserts at 256 rows or 1 MiB of rendered
SQL, and splits SQL transactions at 256 commands or 2 MiB. An irreducible
single row may exceed the byte limit and is executed alone. Only recoverable
PostgreSQL statement-error classes use the legacy statement-by-statement
fallback.

Run the focused regression suite with:

```sh
stack test slipstream:slipstream-batching-test --fast --jobs 2
```
