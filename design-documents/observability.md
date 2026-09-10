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

**Traces** through the ADOT sidecar's OTLP receiver into X-Ray; the
service map it produces is the infrastructure map board's traffic-flow
panel. The processes do not emit spans yet; that is the next instrumentation
step (nginx, strato-api, app-backend, jsonrpc, with the trace id carried in
Kafka message headers).

**Logs** from the cells' convoke files (`logs/*.log`) through the CloudWatch
agent to `/strato/<env>/cell`; tasks already log through awslogs.

**The synthetic check**: a CloudWatch Synthetics canary hits the edge every
minute, reads the latest block over JSON-RPC, records `STRATO/BlockAgeSeconds`
and fails past the configured age. Its failure pages. The time-to-inclusion
step (submit a no-op transaction, wait for the receipt) is the intended
next addition and needs a funded canary key in Secrets Manager.

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

## What the skeleton does not do yet

- Emit traces from the processes; the pipeline is ready, the spans are not.
- The transaction-submitting canary.
- Auto-discover cells: instance ids, ALB names and MSK identifiers are
  passed as context because they live in other apps' outputs.
- Register dashboards and data sources from CDK; Grafana's API is used
  after deploy instead.
