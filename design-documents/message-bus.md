# The shared message bus

Phase 4 of the tiered deployment. An external Kafka-compatible cluster (MSK,
`infra/data-plane` bus stack) sits between the edge tiers and the cores.
Three topics, one partition each, replication factor 2, seven days'
retention:

| Topic | Direction | Producer | Consumer | Encoding |
|---|---|---|---|---|
| `ingest_tx` | edge to core | strato-api (per `busSubmitMode`) | strato-ingest on every core, each with its own consumer group | the node's binary `IngestEvent` |
| `tx_results` | core to edge | slipstream, after each batch commits | strato-api (resolve wakeups), the app history indexer | JSON `{"version":1,"result":{...}}` |
| `chain_events` | core to edge | slipstream, after each batch commits | the app history indexer, other subscribers | JSON `{"version":1,"event":{...}}` |

## What each process does

- **strato-ingest** (new, on every core) consumes `ingest_tx` with a durable
  consumer group named after the host and forwards transactions into the
  core's own broker on a new local topic, also `ingest_tx`. The bus offset is
  committed only after the local produce is acknowledged. A standby core
  therefore has the same transactions in its mempool when it is promoted.
- **strato-sequencer** consumes the local `ingest_tx` durably (consumer group
  `sequencer-ingest`, offset committed after each batch is handed on),
  merged with its existing sources. It keeps reading `unseqevents` from the
  latest offset as before: that topic carries gossip and consensus messages
  that must not be replayed, while transactions dedup by hash.
- **slipstream** publishes each committed batch's transaction results and
  derived contract events. Publishing failures are logged and dropped:
  Postgres stays the source of truth and the bus is a projection of it.
- **strato-api** submits per `busSubmitMode` (`core`, `bus`, or `shadow`,
  which writes both and relies on the mempool's hash dedup) and subscribes to
  `tx_results` from the tip, remembering announced hashes for two minutes.
  `resolve=true` now waits up to a second at a time and wakes the moment a
  result for one of its hashes is announced, so a resolving transaction
  costs a couple of Postgres reads instead of a hundred. Without a bus the
  old 100 x 100 ms poll runs unchanged.

## Client and security

The cores' own broker client (milena) has no TLS or SASL, so every bus
connection uses the librdkafka backend (`streaming-kafka-hw`, module
`Control.Monad.Composable.Streaming.Bus`) with SASL/SCRAM-SHA-512 over TLS,
one SCRAM credential per role (`core`, `api`, `app`) created by the bus
stack under the `AmazonMSK_` prefix. The strato image now ships
`librdkafka1`.

## Configuration

`ethconf.yaml` gains an optional `busConfig`:

```yaml
busConfig:
  busHost: b-1.strato-bus-testnet.xxxx.kafka.us-east-1.amazonaws.com
  busPort: 9096
  busSecurity: sasl_ssl
  busSaslUsername: strato-core
  busSaslPassword: ...
  busSubmitMode: shadow
```

`strato-setup` writes it from `--busHost`, `--busPort`, `--busSecurity`,
`--busSaslUsername` and `--busSaslPassword` (or the `bus_sasl_password`
environment variable), and adds strato-ingest to a core's command file. The
API entrypoint takes the same as `BUS_*` environment variables; the API tier
CDK stack passes them from context and the `AmazonMSK_` secret.

## Rollout

1. Deploy the bus stack; note the bootstrap brokers (`aws kafka
   get-bootstrap-brokers`) and allow the core hosts' and API tier's security
   groups on port 9096.
2. Re-generate each core with `--busHost ... --busSaslUsername strato-core`
   and restart it: strato-ingest starts, the sequencer picks up the local
   `ingest_tx` topic, slipstream begins publishing.
3. Deploy the API tier with `busSubmitMode=shadow`. Every submitted
   transaction now travels both ways; the core dedups. Validate for a day:
   - every hash submitted appears on `ingest_tx` and reaches the mempool
     (compare strato-ingest's forwarded count with strato-api's submit count)
   - resolve latency drops (fewer `transaction_result` queries per submit)
   - no duplicate-nonce rejections, no growth in `sequencer-ingest` lag
4. Switch to `busSubmitMode=bus`. Then remove `--kafkaExternalHost` from the
   cores: the API tier no longer needs their brokers for submits. (VM calls
   still use them until Phase 5.)

Rollback at any point is `busSubmitMode=core` on the API tier; the core-side
consumers are harmless when idle.
