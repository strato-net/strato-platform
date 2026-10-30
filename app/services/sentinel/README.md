# sentinel

Read-only security monitor for STRATO. Polls Cirrus, strato-api and the external bridge chains, and posts Slack alerts. Holds no signing keys.

## Watchers

Each runs every cycle with its own cursor in `STATE_FILE`; one failing watcher does not block the others.

| Watcher | Source | Rule | Severity |
|---|---|---|---|
| events | Cirrus `event` | `OwnershipTransferred` on a contract not deployed in the same tx | 🔴 |
| | | AdminRegistry `AdminAdded` / `AdminRemoved` / `AdminSwapped` / `VotingThresholdSet` / `DefaultVotingThresholdSet` | 🔴 |
| | | Token/Voucher owned by AdminRegistry minted without `IssueExecuted(mint)` in the same tx | 🔴 |
| | | AdminRegistry `WhitelistGranted` / `ContractCreated` | 🟠 |
| | | `IssueExecuted` by an executor/function not in `KNOWN_EXECUTORS` | 🟠 |
| | | Governed mint ≥ `MINT_ALERT_PCT` of supply | 🟠 |
| | | Mint cap change: CDP `CollateralConfigured`, PSM `MintConfigSet`, MetalForge `MetalConfigUpdated` / `MintCapUpdated`, FlashMint `MaxLoanSet` | 🟠 |
| | | AdminRegistry `WhitelistRevoked` / `IssueCreated` | 🟡 |
| | | `NativeDepositCompleted` without an identical `RedemptionRequested` in the external tx | 🔴 |
| | | Native deposit that cannot be verified (chain not monitored, tx not found by the RPC) | 🟠 |
| | | Bridge withdrawal refunded after its Safe tx / mint proposal was created | 🟠 |
| | | Bridge-out > `BRIDGE_OUT_ALERT_USD` | 🔴 |
| | | Bridge-out of a token with no oracle price | 🟠 |
| | | Bridge-out to a first-time destination, or via the instant / hot-wallet path | 🟡 |
| proxies | Cirrus `BlockApps-Proxy` | Logic changed on an AdminRegistry-owned proxy without a matching `setLogicContract` call | 🔴 |
| | | Logic changed on a proxy with another owner | 🟠 |
| | | Logic changed through governance | 🟡 |
| supply | Cirrus `BlockApps-Token` / `BlockApps-Voucher` | Governed token supply up ≥ `SUPPLY_JUMP_PCT` since the last snapshot | 🟠 |
| txs | strato-api transactions + results | Failed call to `<constructor>` on a deployed contract | 🔴 |
| | | Failed with a permission error (onlyOwner, whitelist, admin vote, …) | 🟠 |
| | | ≥ `FAIL_BURST` failures from one sender | 🟠 |
| evm | `eth_getLogs` on `EVM_BRIDGES` | `RepresentationMinted` without an identical, non-aborted STRATO withdrawal | 🔴 |
| | | Role, upgrade, initializer or attestor/threshold/validity change | 🔴 |
| | | Token mapping, pause or any unrecognized event | 🟠 |

## Run

```bash
cp env.example .env   # set NODE_URL, KNOWN_EXECUTORS, EVM_BRIDGES, Slack
npm install
npm run dev           # loop + /health on HEALTH_PORT
npm run once          # single cycle
```

The first start begins at the current head of every source (no history replay). Cursors only advance after Slack accepts the alerts.
