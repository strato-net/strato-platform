# Observability

Section 8 of the tiered deployment plan, as a CDK skeleton in
`infra/observability` plus the metrics the processes had to grow for it.

## What is measured

**Chain health**, the signals that caught the testnet outages, as Prometheus
gauges served by strato-indexer on port 10779 (`Blockchain.ChainMetrics`):
best block number and timestamp (so block age is `time()` minus it), best
sequenced block, world best block, Cirrus tip, `indexer_progress`, and
whether this cell holds the writer lease. The node status mirror sets them
once a second on every cell, writer or standby. Recording rules derive
block age, sequencer-ahead-of-execution, behind-world, indexer lag and
Cirrus lag.

**Process metrics** every Haskell process already exposed, plus the three
that had no endpoint: strato-indexer (10779), ethereum-discover (10780,
peer counts) and strato-ingest (10781, forwarded and dropped counters). The
node's own Prometheus scrape config gained those jobs and lost the dead
process-monitor one.

**Host metrics** per machine from the CloudWatch agent on cells (CPU,
memory, disk usage and IOPS, network, TCP states, aggregated to the
instance) and ECS container metrics from the sidecar on tasks. **Managed
service metrics** from CloudWatch: Aurora replica lag, connections and CPU;
ALB 5xx ratio; MSK consumer lag per group and under-replicated partitions;
EC2 status checks.

**Traces** through the collectors' OTLP receivers into X-Ray; the service
map it produces is the infrastructure map board's traffic-flow panel. Two
kinds of trace, both enabled per process by `OTEL_EXPORTER_OTLP_ENDPOINT`
(the sidecar or cell collector on `http://127.0.0.1:4318`; unset, tracing
is a no-op):

- *Request traces.* nginx (`nginx-packager/tracing.lua`, shared with the
  app's nginx) continues the load balancer's `X-Amzn-Trace-Id` or a client's
  `traceparent`, records a server span per request from `log_by_lua`, and
  hands a W3C `traceparent` to every upstream. strato-api and
  ethereum-jsonrpc continue it with a server span per request
  (`strato-tracing`'s WAI middleware); app-backend does the same with an
  express middleware and puts the `traceparent` on its calls to the node, so
  app, edge and API are one trace.
- *Transaction traces.* No header can follow a transaction through the
  core's broker, so the trace id is derived from the transaction hash
  (`Strato.Tracing.traceIdFromHash`, the hash's first 16 bytes). Every stage
  that knows the hash records its span into that trace without
  coordination: `tx.submit` in strato-api (linked to the request trace it
  arrived in), `tx.forward` in strato-ingest when the bus hands the
  transaction to the core, `tx.received` in the sequencer (whose length is
  the submit-to-sequencer latency, since it starts at the API's submit
  timestamp carried on the ingest event), `tx.sequenced` when a committed
  block carrying it leaves the sequencer, `tx.execute` in vm-runner with
  the gas used and any exception as the span's error, and `tx.result` in
  slipstream when the outcome is durable and published. Submit to result in
  one trace is the time-to-inclusion view, stage by stage.

Spans are batched and shipped as OTLP/JSON by a small in-house exporter in
each process (Haskell, Lua and TypeScript) rather than the OpenTelemetry
SDKs, which keeps the dependency footprint at zero; export failures are
logged once a minute and dropped so tracing never backs up a process.
X-Ray accepts W3C-format trace ids (the deterministic ids are not
timestamp-prefixed), which needs the ADOT collector version pinned in the
sidecar or newer.

**Logs** from the cells' convoke files (`logs/*.log`) through the CloudWatch
agent to `/strato/<env>/cell`; tasks already log through awslogs.

**The synthetic check**: a CloudWatch Synthetics canary hits the edge every
five minutes (a one-minute cadence costs five times more for the same block-age signal), reads the latest block over JSON-RPC, records `STRATO/BlockAgeSeconds`
and fails past the configured age. With `-c canaryKeySecretName` it also
submits a no-op transaction each run: one unit of the native token from the
canary's address to itself, an Ethereum-legacy transaction with an EIP-155
signature and gas price zero, exactly what the app's wallet path sends
(`canary/nodejs/node_modules/strato-tx.js`, verified against the node's own
decoder). It polls the receipt and records `STRATO/TimeToInclusionSeconds`
and `STRATO/TxCanarySuccess`. A missing receipt or a failed result fails
the run, so the existing canary alarm pages; inclusion averaging over 10 s
for two consecutive runs warns.

The key lives in Secrets Manager as JSON `{"privateKey": "0x..."}`,
referenced by name in CDK and read only by the canary's role at run time.
To set one up: generate a key, put it in the secret, run the canary once
(its log prints the address), fund the address with a little native token
for the transfers, and fund it again when the balance runs down. Each run
spends one unit; gas is free at price zero.

## Alerts

Managed Prometheus evaluates `infra/observability/rules/chain-health.yaml`
and routes by severity through its alertmanager to two SNS topics.

| Pages | Warns |
|---|---|
| block age over 30 s | behind the world by more than 10 blocks |
| sequencer more than 50 blocks ahead of execution | Cirrus more than 20 blocks behind |
| eth tables more than 20 blocks behind | invalid (rejected) blocks being seen |
| Cirrus more than 200 blocks behind | fewer than 2 peers |
| writer lease held by zero or two cells | ingest dropping bus events |
| a process's metrics endpoint down 2 min | vm-runner live heap over 12 GB |
| edge 5xx over 1 percent | sustained 403s on the edge, p95 over 2 s |
| synthetic check failing 3 min | Aurora connections or CPU high |
| Aurora replica lag over 5 s | bus under-replicated partitions |
| bus consumer group lag growing | cell memory over 90 percent |
| cell unreachable, cell disk under 15 percent free | |

PagerDuty subscribes to the pages topic and Slack to the warnings topic.

## Dashboards

Four Grafana boards in `infra/observability/dashboards/`, pushed with
`scripts/push-dashboards.sh`:

- **Infrastructure map**: the X-Ray service map as a node graph (traffic
  flow, edge width by request rate, color by error rate once traces flow),
  requests entering each tier, transactions submitted versus forwarded
  versus executed, and the chain tip versus the two indexer tips.
- **Per tier**: edge request rate by status, latency percentiles, 5xx ratio
  and connections; Aurora lag, connections and CPU; bus consumer lag and
  broker throughput; ECS task CPU and memory.
- **Per machine**: host CPU, memory, disk, IOPS, throughput and network
  from the CloudWatch agent, and the RTS live heap and GC share of every
  Haskell process, one variable per host.
- **Chain health**: the six stat tiles (block age, best block, sequencer
  lead, indexer lag, Cirrus lag, lease holders) and their histories, blocks
  and transactions per minute, rejections, peers, ingest and slipstream
  phase timings.

## Measured cost of tracing in the recording process

`stack bench strato-tracing` measures the span vm-runner records per
transaction (five attributes including the hex hash), on an Apple M-series
laptop, criterion, 3 s per case:

| Path | Per call in the recording thread |
|---|---|
| tracing disabled (no endpoint configured, the default) | 3.6 ns, one reference read |
| tracing enabled, successful transaction | 58 ns |
| tracing enabled, failed transaction (exception text) | 58 ns |
| clock read alone (`nowNanos`, fully evaluated) | 266 ns |
| serialising a 512-span batch (exporter thread) | 1.8 ms, 3.5 µs per span |

The enabled path is cheaper than the clock read because the timestamp
arithmetic and the attribute encoding are left as thunks that the exporter
thread forces while serialising: the VM thread pays for the syscall, the
allocation and one STM queue write. A SolidVM transaction executes in
milliseconds, so the span is under 0.01 percent of it either way.

The exporter ceiling was the real finding. As first written it slept a
second between batches of 512, so a process recording more than 500 spans
per second dropped the excess (92 percent delivered at 1000/s, 19 percent
at 5000/s). It now drains back to back while batches fill: against a local
collector it delivers 100 percent up to 5000 spans per second and 97
percent at 10000 (the encoder and the HTTP round trips set that limit);
the queue holds 8192 spans of burst and drops beyond that rather than
growing. The sequencer records two spans per
transaction and vm-runner one, so a cell's per-process rate is the chain's
transaction rate times two at most.

Not measured: the effect of the exporter thread's CPU on vm-runner's own
throughput on a `-N1` core under a saturating block, and the ADOT
collector's own cost on the host. The numbers above bound the recording
side; enable tracing on a testnet cell and compare blocks per second before
mainnet.

## What the skeleton does not do yet

- strato-api's own outgoing calls (to the JSON-RPC server, to bloc) do not
  yet carry `traceparent`; they run in the same process, so the request
  span already covers them.
- Auto-discover cells: instance ids, ALB names and MSK identifiers are
  passed as context because they live in other apps' outputs.
- Register dashboards and data sources from CDK; Grafana's API is used
  after deploy instead.
