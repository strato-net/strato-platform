# STRATO Load Testing Framework

A standalone tool for load testing STRATO blockchain nodes and the Mercata application stack.

Two families of scenarios are supported:

**Application-level scenarios** (recommended for full-stack testing):
- `tokenSale` — replays the canonical Mercata UI bridge-in flow: Sepolia USDC → STRATO USDST → AUTO_FORGE → GOLDST. Each iteration signs a Permit2 typed-data on Sepolia, broadcasts `DepositRouter.deposit(...)`, then posts `/api/bridge/requestDepositAction` with `action: 2` (AUTO_FORGE).
- `forgeBuy` — direct `/api/metal-forge/buy` stress (skips Sepolia + bridge service entirely). Each iteration POSTs `/api/metal-forge/buy { metalToken, payToken, payAmount, minMetalOut }` against the calling user's existing USDST balance on STRATO, executing `MetalForge.mintMetal` in a single on-STRATO tx (USDST → GOLDST). Useful for stressing the metal-forge backend route in isolation, or when no Sepolia funding is available.

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

**Pre-run diagnostics** (run before the iteration loop starts):

- **EOA balance check** — reads the broadcaster EOA's Sepolia ETH and ERC20 balances; warns if either is below the per-iteration requirement so a misconfigured run fails fast instead of spending 5 minutes on AUTO_FORGE timeouts.
- **Per-user STRATO snapshot** (when `logBalances: "summary"`) — one auth-filtered snapshot per unique Keycloak user in the pool plus one shared forge/global snapshot.
- **Recipient pre-loop snapshot** — reads the recipient's USDST + GOLDST directly from Cirrus (keyed by `bridge.stratoRecipientAddress`, NOT auth-filtered). Used as the baseline for the AUTO_FORGE wait.

**Post-run diagnostics** (run after the iteration loop):

- **Sepolia receipt sweep** — fetches `getTransactionReceipt` for every successful broadcast; tags each as `[OK]` (mined + DepositRouted event), `[REVERTED]` (with the EVM revert reason), `[PENDING]`, or `[NOT_FOUND]`. Promotes the per-tx metric status from `submitted` to `confirmed` / `failed` so the summary table is accurate.
- **AUTO_FORGE wait** — polls the recipient's GOLDST balance via Cirrus until either the expected number of mint events lands, the balance settles after some movement (mints may coalesce into one Cirrus update if they land in the same block), or `autoForgeWaitTimeoutSec` elapses. Final outcome tagged `[OK]` / `[PARTIAL]` / `[TIMEOUT]`.
- **Per-user STRATO snapshot delta** + forge delta + pool-aggregate (multi-user runs only).

Key config fields under `scenarios.tokenSale`:

| Field | Meaning |
|---|---|
| `totalTxCount` | Number of sales to execute (default 1000) |
| `timeWindowMs` | Target window — the test paces itself to finish in this many ms (default 30000) |
| `concurrentUsers` | Parallel virtual users (default 50) |
| `externalChainId` | Source chain for the bridge leg (`"1"` Ethereum, `"11155111"` Sepolia, `"8453"` Base, …) |
| `metalTokenAddress` | **REQUIRED.** Metal token on STRATO (fetch GOLDST from `/api/metal-forge/configs`) |
| `payTokenAddress` | Intermediate STRATO-side token (USDST) — used for balance snapshots only. Defaults to helium USDST. |
| `metalForgeAddress` | Helium MetalForge contract — used only for forge-side balance reads when `logBalances` ≠ `"none"`. |
| `bridge.sepoliaRpcUrl` | Sepolia JSON-RPC URL (Alchemy/Infura/dRPC) |
| `bridge.sepoliaPrivateKey` | Funded EOA private key (0x-prefixed) |
| `bridge.depositRouterAddress` | DepositRouter contract address on Sepolia |
| `bridge.sepoliaTokenAddress` | ERC20 to bridge (Sepolia USDC = `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) |
| `bridge.stratoRecipientAddress` | Recipient on STRATO (where USDST and AUTO_FORGE GOLDST land) |
| `bridge.targetStratoToken` | STRATO-side intermediate token (USDST) |
| `bridge.amountPerTx` | Per-bridge amount in the token's smallest unit (default `"1000"` = 0.001 USDC) |
| `bridge.awaitConfirmation` | If true, await each Sepolia receipt during the iteration loop. Default false (recommended; the post-loop receipt sweep covers correctness). |
| `bridge.permit2Address` | Override the canonical Permit2 (rarely needed) |
| `bridge.permitDeadlineSec` | Permit2 signature deadline window (default 1800s) |
| `requestRetries` | Retries for transient HTTP 429/5xx on the bridgeRequest leg (default 3) |
| `logBalances` | `"summary"` (default) or `"none"`. `summary` produces per-user STRATO balance snapshots before/after the run, a shared forge snapshot, and a pool-aggregate line when `users:` has > 1 entry. `none` skips all balance reads for max throughput. |
| `autoForgeWaitTimeoutSec` | Max seconds to poll the recipient's GOLDST balance after the loop, waiting for the bridge service + AUTO_FORGE to land mints. Default 300. Set to 0 to skip the wait (faster runs but no end-to-end correctness check). |
| `autoForgeWaitPollIntervalSec` | Polling interval during the AUTO_FORGE wait (default 5s). |
| `includePageLoad` | If true, do the 4 Fund-page GETs once per user during warm-up |
| `users` | Optional pool of Keycloak credentials; round-robin'd across `concurrentUsers` BackendClients. Each unique user gets its own auth-filtered balance snapshot. |

Overrides: `--total-tx 500 --time-window 15000 --concurrent-users 100 --backend-url https://...`

The summary table in the report breaks the metrics out per leg: `tokenSale:sepoliaDeposit`, `tokenSale:bridgeRequest`, and `tokenSale:pageLoad:<step>`. A terminal line at the end reports combined sales/s (pair rate) and call/s (individual request rate).

## Running the Forge Buy scenario

```bash
npm run test:forge-buy -- --config config.highlevel.yaml
```

Replays the simpler "user already holds USDST on STRATO; clicks Buy Gold" flow. Per iteration POSTs `/api/metal-forge/buy { metalToken, payToken, payAmount, minMetalOut }`; the backend executes `MetalForge.mintMetal` on STRATO in a single tx (USDST → GOLDST). No Sepolia, no bridge service, no asynchronous wait — the on-STRATO tx hash is in the response body the moment the POST returns.

Optional warmup: 2 GETs (`/api/metal-forge/configs`, `/api/tokens/balance`) once per user.

Key config fields under `scenarios.forgeBuy`:

| Field | Meaning |
|---|---|
| `metalTokenAddress` | **REQUIRED.** GOLDST address on STRATO. |
| `payTokenAddress` | USDST on STRATO. Defaults to helium USDST. |
| `payAmount` | USDST spent per iteration in 18-decimal wei. Default `"1000000000000000"` (= 0.001 USDST). |
| `minMetalOut` | Slippage guard. Default `"0"` (accept any output). |
| `totalTxCount` | Number of buys to execute (default 1000). |
| `timeWindowMs` | Target window — the test paces itself to finish in this many ms (default 30000). |
| `concurrentUsers` | Parallel virtual users (default 50). |
| `metalForgeAddress` | Helium MetalForge — used only for forge-side balance reads when `logBalances` ≠ `"none"`. |
| `includePageLoad` | If true (default), do the 2 page-load GETs once per user during warm-up. |
| `requestRetries` | Retries on 429 / 5xx for `/api/metal-forge/buy`. Default 3. |
| `logBalances` | `"summary"` (default) or `"none"`. `summary` produces per-user STRATO balance snapshots before/after the run, a shared forge snapshot, and a pool-aggregate Δ line for multi-user pools. `none` skips all balance reads for max throughput. |
| `users` | Optional pool of Keycloak credentials. Each user must hold sufficient USDST (≥ `totalTxCount × payAmount ÷ concurrentUsers`) plus voucher gas headroom. Round-robin'd across `concurrentUsers` BackendClients. |

Overrides: `--total-tx 500 --time-window 15000 --concurrent-users 100 --backend-url https://...`

The summary table breaks the metrics out as `forgeBuy:buyMetal` and `forgeBuy:pageLoad:<step>`. Latency reflects the full backend round-trip including the on-STRATO MetalForge.mintMetal tx submission.

**Difference vs. tokenSale:** tokenSale exercises the full bridge pipeline including Sepolia, Permit2, the MercataBridge contract, the bridge service, and AUTO_FORGE. forgeBuy is a focused stress of just the metal-forge backend route + on-STRATO MetalForge contract — no external chains, no daemon polling, much shorter end-to-end latency. Use tokenSale to validate the production flow; use forgeBuy to find saturation points on the metal-forge code path in isolation.

## Test-user and funding prerequisites

### Keycloak users

The scenario authenticates against Keycloak using password grant. You need at minimum one user under the `mercata` realm, with the `clientId` / `clientSecret` for the load-test OAuth client. To run at full parallelism you'll want a pool — create them via the Keycloak admin UI or REST API and list them under the scenario's `users:` array. If you provide fewer users than `concurrentUsers`, the framework cycles through what's given (multiple virtual users may share the same Keycloak account).

Voucher / USDST funding requirements differ by scenario:

- **`tokenSale`** — the bridge service GRANTS vouchers to the recipient as part of completing each deposit (~2500 vouchers per bridge in observed runs), so steady-state voucher balance grows during the run. The recipient still needs an initial voucher balance to cover the on-STRATO bridgeRequest tx fee on the first iterations before the bridge service has caught up.
- **`forgeBuy`** — the calling user SPENDS vouchers per iteration (~200 vouchers per `MetalForge.mintMetal` call) plus `payAmount` of USDST. Each user in the pool must hold ≥ `totalTxCount × payAmount ÷ concurrentUsers` of USDST and ~`200 × totalTxCount ÷ concurrentUsers × 1.5` (50% safety) of voucher headroom.

Transfer USDST between users via the `/api/tokens/transfer` route from an already-funded account, or mint voucher balances through the governance path.

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

# High-level (application stack)
npm run test:token-sale       # Sepolia USDC -> USDST -> AUTO_FORGE -> GOLDST
npm run test:forge-buy        # direct USDST -> GOLDST (no Sepolia, no bridge service)

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
  -s, --scenario <name>     Run a specific scenario: contractDeploy | functionCall | mixedWorkload | tokenSale | forgeBuy
  --batch-size <n>          Override batch size (low-level scenarios)
  --batch-count <n>         Override batch count (low-level scenarios)
  --concurrent-users <n>    Override concurrentUsers (tokenSale, forgeBuy)
  --total-tx <n>            Override totalTxCount (tokenSale, forgeBuy)
  --time-window <ms>        Override timeWindowMs (tokenSale, forgeBuy)
  --backend-url <url>       Override backend URL (tokenSale, forgeBuy)
  --submit-mode <mode>      Submit mode for low-level scenarios: sequential (default) or pipeline
  --nodes <names>           Comma-separated node names to target
  --report-dir <path>       Output directory for reports
  -v, --verbose             Enable verbose per-iteration logging
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

Each scenario records one or more `TxMetric` entries per iteration, scoped under
a sub-scenario name (e.g. `tokenSale:sepoliaDeposit`, `tokenSale:bridgeRequest`,
`forgeBuy:buyMetal`, `tokenSale:pageLoad:metalForgeConfigs`). Per-tx fields:

| Metric | Description |
|--------|-------------|
| `submitDuration` | The wall-clock from the start of the relevant operation to its first observable terminal signal: HTTP response time for backend POSTs (`bridgeRequest`, `buyMetal`, `pageLoad:*`); `eth_sendRawTransaction` round-trip for Sepolia broadcasts; full submit-and-poll for low-level scenarios (`contractDeploy`, `functionCall`, `mixedWorkload`). |
| `confirmDuration` | Only meaningful for low-level scenarios (time spent polling `/bloc/v2.2/transactions/results`). 0 for application-level scenarios — those treat the backend response as the terminal signal. The Sepolia receipt sweep (tokenSale) updates the `status` post-loop without rewriting this field. |
| `totalDuration` | `submitDuration + confirmDuration` (end-to-end). For application-level scenarios this equals `submitDuration`. |
| `status` | `confirmed`, `failed`, `submitted`, or `timeout`. The Sepolia receipt sweep promotes `submitted` → `confirmed` / `failed` after the iteration loop ends. |

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
