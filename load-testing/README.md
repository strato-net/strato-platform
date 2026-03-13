# STRATO Load Testing Framework

A standalone tool for load testing STRATO blockchain nodes. Submits batches of transactions via `/strato/v2.3/transaction/parallel`, polls for results via `/bloc/v2.2/transactions/results`, and generates performance reports with latency breakdowns and TPS metrics.

## Setup

```bash
cd load-testing
npm install
```

## Configuration

Copy the example config and fill in your node details:

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` with your node URLs and OAuth credentials:

```yaml
nodes:
  - name: "node-1"
    url: "https://node1.example.com"
    auth:
      openIdDiscoveryUrl: "https://keycloak.example.com/realms/strato/.well-known/openid-configuration"
      clientId: "strato-client"
      clientSecret: "secret"
      username: "loadtest-user"
      password: "password"
```

### Config Reference

| Section | Field | Default | Description |
|---------|-------|---------|-------------|
| `gas.limit` | | `32100000000` | Gas limit per transaction |
| `gas.price` | | `1` | Gas price |
| `polling.interval` | | `2000` | Milliseconds between result polls |
| `polling.timeout` | | `120000` | Milliseconds before giving up on a batch |
| `scenarios.multiNode.enabled` | | `false` | Run scenarios against all nodes simultaneously |
| `report.outputDir` | | `./reports` | Output directory for reports |
| `report.formats` | | `["json", "html"]` | Report formats to generate |

## Scenarios

### contractDeploy

Deploys batches of a Solidity contract repeatedly.

```yaml
scenarios:
  contractDeploy:
    enabled: true
    batchSize: 10       # transactions per batch
    batchCount: 5        # number of batches
    batchDelay: 0        # ms delay between batches
    contractSource: "contracts/SimpleStorage.sol"
    contractName: "SimpleStorage"
    contractArgs:
      _value: "42"
```

### functionCall

Deploys a setup contract once, then fires batches of function calls against it.

```yaml
scenarios:
  functionCall:
    enabled: true
    batchSize: 20
    batchCount: 10
    batchDelay: 0
    setupContract: "contracts/SimpleIncrement.sol"
    contractName: "SimpleIncrement"
    method: "increment"
    args: {}
```

### mixedWorkload

Combines contract deploys and function calls in each batch according to `deployRatio`.

```yaml
scenarios:
  mixedWorkload:
    enabled: true
    deployRatio: 0.3     # 30% deploys, 70% function calls
    totalTxCount: 100
    batchSize: 10
```

## Usage

### npm Scripts

```bash
# Run all enabled scenarios
npm run test:all

# Run a specific scenario
npm run test:deploy
npm run test:calls
npm run test:mixed

# Quick smoke test (5 txs x 2 batches)
npm run test:quick
```

### CLI Options

```
ts-node src/cli.ts [options]

Options:
  -c, --config <path>       Path to config YAML file (default: "config.yaml")
  -s, --scenario <name>     Run a specific scenario: contractDeploy, functionCall, mixedWorkload
  --batch-size <n>          Override batch size for all scenarios
  --batch-count <n>         Override batch count for all scenarios
  --nodes <names>           Comma-separated node names to target
  --report-dir <path>       Output directory for reports
  -v, --verbose             Enable verbose per-batch logging
```

### Examples

```bash
# Run only contract deploys with 5 batches of 20
ts-node src/cli.ts --scenario contractDeploy --batch-size 20 --batch-count 5

# Target a specific node
ts-node src/cli.ts --nodes node-1

# Verbose output with custom report directory
ts-node src/cli.ts --verbose --report-dir ./my-reports

# Use a different config file
ts-node src/cli.ts --config staging.yaml
```

## Reports

Reports are written to `./reports/` (configurable) in two formats:

### JSON

`report-<timestamp>.json` contains the full dataset: per-transaction metrics, per-batch metrics, computed statistics, timeline buckets, and all errors. Useful for programmatic analysis or importing into other tools.

### HTML

`report-<timestamp>.html` is a self-contained page (Chart.js loaded from CDN) with:

- **Summary table** — per-scenario, per-node breakdown of tx counts, error rates, latency percentiles (p50/p95/p99), and TPS
- **Transaction timeline chart** — submitted, confirmed, and failed transactions over time
- **Latency comparison chart** — bar chart of submit, confirm, and total latency percentiles across scenarios
- **Error listing** — first 100 errors with tx hash, node, scenario, and message

## Metrics Collected

For each transaction:

| Metric | Description |
|--------|-------------|
| `submitDuration` | Time to POST the batch to `/transaction/parallel` |
| `confirmDuration` | Time spent polling `/transactions/results` until terminal status |
| `totalDuration` | `submitDuration + confirmDuration` (end-to-end) |
| `status` | `confirmed`, `failed`, or `timeout` |

Aggregate stats computed per scenario per node:

- **Latency percentiles**: min, p50, p95, p99, max, mean for submit/confirm/total
- **Submit TPS**: total transactions / wall clock duration
- **Confirmed TPS**: successful transactions / wall clock duration
- **Error rate**: (failed + timeout) / total

## Multi-Node Testing

When `scenarios.multiNode.enabled: true` and multiple nodes are configured, each scenario runs against all nodes concurrently via `Promise.all`. This measures how the network handles parallel load from multiple entry points. Each node gets its own column in the report.

## Custom Contracts

Place Solidity files in `contracts/` and reference them in the config:

```yaml
scenarios:
  contractDeploy:
    contractSource: "contracts/MyContract.sol"
    contractName: "MyContract"
    contractArgs:
      param1: "value1"
```

For function call scenarios, the `setupContract` is deployed once with `?resolve=true` before the load test begins, then `method` is called repeatedly.
