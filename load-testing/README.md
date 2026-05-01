# STRATO Load Testing Framework

A standalone tool for load testing STRATO blockchain nodes and the Mercata application stack.

Two families of scenarios are supported:

**Application-level scenario** (recommended for full-stack testing):
- `tokenSale` — replays the canonical Mercata UI bridge-in flow: Sepolia USDC → STRATO USDST → AUTO_FORGE → GOLDST. Each iteration signs a Permit2 typed-data on Sepolia, broadcasts `DepositRouter.deposit(...)`, then posts `/api/bridge/requestDepositAction` with `action: 2` (AUTO_FORGE).

**Low-level scenarios** (direct node API testing, pre-existing):
- `contractDeploy`, `functionCall`, `mixedWorkload` — submit batches of txs directly via `/strato/v2.3/transaction/parallel` and poll `/bloc/v2.2/transactions/results`.

Every run writes a JSON and HTML report to `./reports/` with actual TPS, success/failure counts, latency percentiles, timeline charts, and an error listing.

## Setup

```bash
cd load-testing
npm install
```

## Configuration

For the high-level `tokenSale` scenario that goes through the Mercata backend / UI / Sepolia:

```bash
cp config.highlevel.example.yaml config.highlevel.yaml
# then edit config.highlevel.yaml with credentials + addresses
```

For low-level direct-node scenarios (`contractDeploy`, `functionCall`, `mixedWorkload`) that target `/strato/v2.3` and `/bloc/v2.2` directly, use the pre-existing `config.example.yaml`:

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

## Running the Token Sale scenario

```bash
npm run test:token-sale -- --config config.highlevel.yaml
```

Replays the "Fund > Bridge-In (Sepolia USDC → STRATO USDST → AUTO_FORGE → GOLDST)" composition performed by `mercata/ui/src/components/bridge/BridgeIn.tsx`. Each "sale" is the pair of operations the UI triggers once the user confirms the deposit:

1. **Sepolia leg** — sign a Permit2 `PermitTransferFrom` typed-data (EIP-712), then broadcast `DepositRouter.deposit(USDC, amount, stratoAddress, USDST, nonce, deadline, signature)` on Sepolia. One funded EOA signs every iteration with sequential nonces.
2. **Bridge-request leg** — `POST /api/bridge/requestDepositAction { externalChainId, externalTxHash, action: 2, targetToken: GOLDST }`. The bridge service (`mercata/services/bridge`) polls Sepolia, sees the `DepositRouted` event, mints USDST to the recipient and auto-forges USDST → GOLDST server-side.

Optional per-user warm-up replays the GETs the Fund page fires on mount:

- `GET /api/bridge/networkConfigs`
- `GET /api/bridge/depositActions`
- `GET /api/bridge/bridgeableTokens/{externalChainId}`
- `GET /api/metal-forge/configs`

On first run with a given Sepolia EOA, the broadcaster submits a one-time `approve(MAX)` so Permit2 can spend the configured ERC20. After that every iteration only signs typed-data and calls `DepositRouter.deposit(...)`.

Key config fields under `scenarios.tokenSale`:

| Field | Meaning |
|---|---|
| `totalTxCount` | Number of sales to execute (default 1000) |
| `timeWindowMs` | Target window — the test paces itself to finish in this many ms (default 30000) |
| `concurrentUsers` | Parallel virtual users (default 50) |
| `externalChainId` | Source chain for the bridge leg (`"1"` Ethereum, `"11155111"` Sepolia, `"8453"` Base, …) |
| `metalTokenAddress` | Metal token on STRATO (fetch GOLDST from `/api/metal-forge/configs`) |
| `bridge.sepoliaRpcUrl` | Sepolia JSON-RPC URL (Alchemy/Infura/dRPC) |
| `bridge.sepoliaPrivateKey` | Funded EOA private key (0x-prefixed) |
| `bridge.depositRouterAddress` | DepositRouter contract address on Sepolia |
| `bridge.sepoliaTokenAddress` | ERC20 to bridge (Sepolia USDC = `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) |
| `bridge.stratoRecipientAddress` | Recipient on STRATO |
| `bridge.targetStratoToken` | STRATO-side intermediate token (USDST) |
| `bridge.amountPerTx` | Per-bridge amount in the token's smallest unit (default `"1000"` = 0.001 USDC) |
| `bridge.awaitConfirmation` | If true, await the Sepolia receipt before posting the bridge request |
| `bridge.permit2Address` | Override the canonical Permit2 (rarely needed) |
| `bridge.permitDeadlineSec` | Permit2 signature deadline window (default 1800s) |
| `pipelineMode` | If true, run in two phases (broadcast all → bridgeRequest all) instead of per-worker sequential |
| `sepoliaConcurrency` | Override Phase 1 concurrency (default = `concurrentUsers`) |
| `backendConcurrency` | Override Phase 2 concurrency (default = `concurrentUsers`) |
| `requestRetries` | Retries for transient HTTP 429/5xx on the bridgeRequest leg (default 3) |
| `logBalances` | `"none"` or `"summary"` — read STRATO balances before/after the run |
| `includePageLoad` | If true, do the 4 Fund-page GETs once per user during warm-up |
| `users` | Optional pool of credentials; cycles across concurrent users |

Overrides: `--total-tx 500 --time-window 15000 --concurrent-users 100 --backend-url https://...`

The summary table in the report breaks the metrics out per leg: `tokenSale:sepoliaDeposit`, `tokenSale:bridgeRequest`, and `tokenSale:pageLoad:<step>`. A terminal line at the end reports combined sales/s (pair rate) and call/s (individual request rate).

## Test-user and funding prerequisites

### Keycloak users

The scenario authenticates against Keycloak using password grant. You need at minimum one user under the `mercata` realm, with the `clientId` / `clientSecret` for the load-test OAuth client. To run at full parallelism you'll want a pool — create them via the Keycloak admin UI or REST API and list them under the scenario's `users:` array. If you provide fewer users than `concurrentUsers`, the framework cycles through what's given (multiple virtual users may share the same Keycloak account).

Each test user's STRATO address must hold sufficient voucher or USDST balance to cover the gas fee for the on-STRATO portion of the bridge-request call. Transfer USDST to the test users via the `/api/tokens/transfer` route from an already-funded account, or mint voucher balances through the governance path.

### Sepolia wallet funding

Fund the `bridge.sepoliaPrivateKey` EOA with:

- **Sepolia USDC** — Circle's faucet at <https://faucet.circle.com> dispenses `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Budget `totalTxCount × amountPerTx` of USDC (e.g. 1000 × 0.001 USDC = 1 USDC for a default run).
- **Sepolia ETH for gas** — fund via faucets:
  - <https://sepoliafaucet.com>
  - <https://faucets.chain.link>
  - <https://www.alchemy.com/faucets/ethereum-sepolia>

Rough sizing: each deposit consumes ~150k gas at ~30 gwei ≈ 0.0000045 ETH. For 1000 sales budget ~0.005 ETH (+ ~0.000005 ETH for the one-time Permit2 approve on first run + faucet minimums).

### DepositRouter deployment

The bridge service expects `DepositRouter.sol` deployed on Sepolia.

1. Deploy `mercata/ethereum/contracts/bridge/DepositRouter.sol` to Sepolia via the hardhat project in `mercata/ethereum/`.
2. Register the deployed address + supported token mappings (USDC ↔ USDST) in the on-chain `MercataBridge` contract on STRATO (see `mercata/services/bridge/README.md`).
3. Configure the bridge service's `CHAIN_11155111_RPC_URL` env var and ensure it is running.
4. Paste the Sepolia DepositRouter address into `config.highlevel.yaml` under `scenarios.tokenSale.bridge.depositRouterAddress`.

## Reports

After any run, `./reports/report-<timestamp>.html` opens in a browser and shows:
- **Summary table** — per-scenario: total / success / failure / timeout / error-rate / submit-confirm-total p50/p95/p99 / submit TPS / confirmed TPS.
- **Transaction timeline chart** — submitted, confirmed, failed per second.
- **Latency comparison chart** — bar chart of percentiles.
- **Error listing** — first 100 errors.

## Legacy scenarios (direct node API)

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
# Run all enabled scenarios (per the config file)
npm run test:all

# High-level
npm run test:token-sale

# Low-level (direct node) scenarios
npm run test:deploy
npm run test:calls
npm run test:mixed

# Quick smoke test (5 txs x 2 batches)
npm run test:quick

# TypeScript typecheck only
npm run typecheck
```

### CLI Options

```
ts-node src/cli.ts [options]

Options:
  -c, --config <path>       Path to config YAML file (default: "config.yaml")
  -s, --scenario <name>     Run a specific scenario: contractDeploy | functionCall | mixedWorkload | tokenSale
  --batch-size <n>          Override batch size for low-level scenarios
  --batch-count <n>         Override batch count for low-level scenarios
  --concurrent-users <n>    Override concurrentUsers (tokenSale)
  --total-tx <n>            Override totalTxCount (tokenSale)
  --time-window <ms>        Override timeWindowMs (tokenSale)
  --backend-url <url>       Override backend URL (tokenSale)
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
