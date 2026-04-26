# STRATO Load Testing Framework

A standalone tool for load testing STRATO blockchain nodes and the Mercata application stack.

Two families of scenarios are supported:

**Application-level scenarios** (recommended for full-stack testing):
- `tokenSale` — token sale TPS via the Mercata backend (Scenario 1)
- `jsonRpcStress` — JSON-RPC stress via the `/rpc/{chainId}` proxy (Scenario 2)
- `fullApp` — multi-step user workflows against the full app stack (Scenario 3)
- `bridgeIn` — Ethereum Sepolia → STRATO bridge-in via ethers.js (Scenario 4)

**Low-level scenarios** (direct node API testing, pre-existing):
- `contractDeploy`, `functionCall`, `mixedWorkload` — submit batches of txs directly via `/strato/v2.3/transaction/parallel` and poll `/bloc/v2.2/transactions/results`.

Every run writes a JSON and HTML report to `./reports/` with actual TPS, success/failure counts, latency percentiles, timeline charts, and an error listing.

## Setup

```bash
cd load-testing
npm install
```

## Configuration

For the high-level application-layer scenarios (`tokenSale`, `jsonRpcStress`, `fullApp`, `bridgeIn`) that go through the Mercata backend / UI / external chains:

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

## Running the four Mercata scenarios

Each scenario has a dedicated npm script. They all read the same YAML config and obey `--config`, `--verbose`, `--report-dir` and the overrides listed in `npm run test:token-sale -- --help`.

### Scenario 1 — Token Sale TPS (1,000 sales / 30 s)

```bash
npm run test:token-sale -- --config config.highlevel.yaml
```

Replays the "Fund > Bridge-In (Ethereum → STRATO, USDC → GOLDST)" composition performed by `mercata/ui/src/components/bridge/BridgeIn.tsx`. Each "sale" is the pair of backend calls the UI triggers once the user confirms the deposit:

1. `POST /api/bridge/requestDepositAction` — queues the AUTO_FORGE post-deposit action (bridge.service.ts).
2. `POST /api/metal-forge/buy` — approves USDST and calls `MetalForge.mintMetal(metalToken, payToken, payAmount, minMetalOut)` on STRATO (metalForge.service.ts).

Optional per-user warm-up replays the GETs the Fund page fires on mount:

- `GET /api/bridge/networkConfigs`
- `GET /api/bridge/depositActions`
- `GET /api/bridge/bridgeableTokens/{externalChainId}`
- `GET /api/metal-forge/configs`

The Ethereum-side `Permit2.approve` + `DepositRouter.deposit` are **not** replayed per iteration — they cost real gas and real block time. Either supply a previously-broadcast `externalTxHash` to include the bridge-request leg, or leave `skipBridgeRequest: true` (the default) to exercise only the on-STRATO `/metal-forge/buy` call.

Key config fields under `scenarios.tokenSale`:

| Field | Meaning |
|---|---|
| `totalTxCount` | Number of sales to execute (default 1000) |
| `timeWindowMs` | Target window — the test paces itself to finish in this many ms (default 30000) |
| `concurrentUsers` | Parallel virtual users (default 50) |
| `externalChainId` | Source chain for the bridge leg (`"1"` Ethereum, `"11155111"` Sepolia, `"8453"` Base, …) |
| `externalTxHash` | Real external tx hash to replay through `requestDepositAction`. Empty = skip. |
| `action` | Post-deposit action (`2` AUTO_FORGE, `1` AUTO_SAVE lend) |
| `metalTokenAddress` | Metal token on STRATO (fetch GOLDST from `/api/metal-forge/configs`) |
| `payTokenAddress` | Pay token on STRATO (USDST = `937efa7e3a77e20bbdbd7c0d32b6514f368c1010`) |
| `payAmount` | Pay amount in 18-dec wei |
| `minMetalOut` | Slippage-protection floor on metal out |
| `includePageLoad` | If true, do the 4 Fund-page GETs once per user during warm-up |
| `skipBridgeRequest` | If true (default), skip the `/bridge/requestDepositAction` call |
| `skipBuyMetal` | If true, skip the `/metal-forge/buy` call (e.g. to exercise only the bridge leg) |
| `users` | Optional pool of credentials; cycles across concurrent users |

Overrides: `--total-tx 500 --time-window 15000 --concurrent-users 100 --backend-url https://...`

The summary table in the report breaks the metrics out per leg: `tokenSale:bridgeRequest`, `tokenSale:buyMetal`, and `tokenSale:pageLoad:<step>`. A terminal line at the end reports combined sales/s (pair rate) and call/s (individual request rate).

### Scenario 2 — JSON-RPC stress (300 concurrent users)

```bash
npm run test:rpc -- --config config.highlevel.yaml
```

Hits `https://app.testnet.strato.nexus/rpc/{chainId}` (configurable). The default method rotation uses STRATO-implemented methods only — `eth_blockNumber`, `eth_chainId`, `eth_gasPrice`, `net_version`, `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode`, `web3_sha3`. `eth_getLogs` and `eth_getTransactionReceipt` are intentionally excluded (unimplemented in `strato/api/ethereum-jsonrpc`).

Key config fields under `scenarios.jsonRpcStress`:
| Field | Meaning |
|---|---|
| `rpcUrl` | Full RPC URL (including `/rpc/<chainId>` suffix) |
| `concurrentUsers` | Parallel virtual users (default 300) |
| `durationMs` | Total test duration (default 60000) |
| `thinkTimeMs` | Per-call delay per user (default 0) |
| `authenticated` | If true, attach the node[0] bearer token (currently required by the mercata backend's `/rpc/:chainId` route) |
| `methods` | Optional custom method rotation with `weight` and `params` |

Overrides: `--concurrent-users 150 --duration 30000 --rpc-url https://...`

### Scenario 3 — Full application simulation (300 concurrent users)

```bash
npm run test:full-app -- --config config.highlevel.yaml
```

Each virtual user walks through a multi-step workflow that mimics a real session. The built-in default workflow is: `GET /` → `GET /api/tokens` → `GET /api/tokens/balance` → `GET /api/config` → `GET /api/vouchers/balance` → `GET /api/events` → `POST /api/tokens/transfer`. Each step can have its own `thinkTimeMs`. Custom workflows may be specified in YAML with `{tokenAddress}`, `{recipientAddress}`, `{amountPerTx}` placeholders.

Key config fields under `scenarios.fullApp`:
| Field | Meaning |
|---|---|
| `baseUrl` | Base URL of the application (default `https://app.testnet.strato.nexus`) |
| `concurrentUsers` | Parallel virtual users (default 300) |
| `durationMs` | Total test duration (default 120000) |
| `iterationsPerUser` | Optional — caps workflow loops per user |
| `workflow` | Optional custom step list |
| `users` | Optional pool of credentials |

Overrides: `--concurrent-users 100 --duration 60000 --backend-url https://...`

### Scenario 4 — Ethereum Sepolia → STRATO bridge-in (50 tx / 30 s)

```bash
npm run test:bridge-in -- --config config.highlevel.yaml
```

Uses `ethers.js` to broadcast `DepositRouter.depositETH(stratoAddress, targetStratoToken)` transactions on Sepolia from a single funded EOA, using sequential nonces for parallel submission. The Mercata bridge service polls `eth_getLogs` on Sepolia, detects each `DepositRouted` event, and credits the recipient on STRATO.

Key config fields under `scenarios.bridgeIn`:
| Field | Meaning |
|---|---|
| `totalBridgeIns` | Number of bridge-in txs (default 50) |
| `timeWindowMs` | Target window (default 30000) |
| `sepoliaChainId` | 11155111 |
| `sepoliaRpcUrl` | Sepolia JSON-RPC (Infura/Alchemy/dRPC) |
| `sepoliaPrivateKey` | Funded EOA private key |
| `depositRouterAddress` | DepositRouter address on Sepolia |
| `depositMode` | `ETH` (default — uses `depositETH`, no signatures) or `ERC20` (requires Permit2 signing — not yet supported here) |
| `amountPerTx` | Wei per bridge-in |
| `stratoRecipientAddress` | Recipient on STRATO (hex, no 0x) |
| `targetStratoToken` | STRATO-side token address (hex, no 0x) |
| `awaitSepoliaConfirmation` | If true, wait for each Sepolia receipt |
| `gasLimit`, `maxFeePerGasGwei`, `maxPriorityFeePerGasGwei` | Tx overrides |
| `startNonce` | Override starting nonce (default = `getTransactionCount("pending")`) |

Overrides: `--total-tx 20 --time-window 15000`

## Test-user and funding prerequisites

### Keycloak users (scenarios 1, 2, 3)

Each scenario authenticates against Keycloak using password grant. You need at minimum one user under the `mercata` realm, with the `clientId` / `clientSecret` for the load-test OAuth client. To run Scenarios 1 and 3 at full parallelism you'll want a pool — create them via the Keycloak admin UI or REST API and list them under the scenario's `users:` array. If you provide fewer users than `concurrentUsers`, the framework cycles through what's given (multiple virtual users may share the same Keycloak account).

Each test user's STRATO address must hold:
- Sufficient balance of the token being sold/transferred (`tokenContractAddress`).
- Sufficient USDST or voucher balance to cover the **0.01 USDST per tx gas fee** — a 1000-tx run needs at least 10 USDST per funding user. Transfer USDST to the test users via the `/api/tokens/transfer` route from an already-funded account, or mint voucher balances through the governance path.

### Sepolia wallet funding (scenario 4)

Fund the `sepoliaPrivateKey` EOA with Sepolia ETH from any public faucet:
- <https://sepoliafaucet.com>
- <https://faucets.chain.link>
- <https://www.alchemy.com/faucets/ethereum-sepolia>

Rough sizing: each bridge-in sends `amountPerTx` plus ~150k gas at ~30 gwei ≈ 0.0000045 ETH in gas. For 50 bridge-ins at the default 0.000001 ETH amount, budget ~0.001 ETH (+ faucet minimums).

### DepositRouter deployment (scenario 4)

`mercata/ethereum/.openzeppelin/` currently only has a Base Sepolia manifest. To run Scenario 4 against Ethereum Sepolia:

1. Deploy `mercata/ethereum/contracts/bridge/DepositRouter.sol` to Sepolia via the hardhat project in `mercata/ethereum/`.
2. Register the deployed address + supported token mappings in the on-chain `MercataBridge` contract on STRATO (see `mercata/services/bridge/README.md`).
3. Configure the bridge service's `CHAIN_11155111_RPC_URL` env var and ensure it is running.
4. Paste the Sepolia DepositRouter address + matching `targetStratoToken` into `config.highlevel.yaml`.

## Reports

After any run, `./reports/report-<timestamp>.html` opens in a browser and shows:
- **Summary table** — per-scenario: total / success / failure / timeout / error-rate / submit-confirm-total p50/p95/p99 / submit TPS / confirmed TPS.
- **Transaction timeline chart** — submitted, confirmed, failed per second.
- **Latency comparison chart** — bar chart of percentiles.
- **Error listing** — first 100 errors.

For RPC and full-app scenarios, each HTTP request is recorded as a "tx" with `submitDuration` = HTTP latency and `confirmDuration` = 0. Methods/steps appear as `jsonRpcStress:eth_blockNumber` and `fullApp:purchase` respectively in the summary table.

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

# Run a specific scenario
npm run test:token-sale       # Scenario 1
npm run test:rpc              # Scenario 2
npm run test:full-app         # Scenario 3
npm run test:bridge-in        # Scenario 4

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
