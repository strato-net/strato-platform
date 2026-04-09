# Yield Vault Live Tools

Live inspection and direct-call scripts for deployed `YieldVault` contracts on
STRATO testnet/mainnet.

These scripts:
- read a bearer token from `ACCESS_TOKEN` or `~/.secrets/stratoToken`
- default to the testnet vault address `8c0f17df514efaee2baf1e59923fff700c5ca2b7`
- talk directly to public STRATO endpoints

## Scripts

### `inspectLiveVault.js`

Read-only inspector for the configured live vault.

```bash
node inspectLiveVault.js
```

### `vaultDirectFlow.js`

CLI for direct live calls:

```bash
node vaultDirectFlow.js inspect
node vaultDirectFlow.js set-strategy <strategyAddress>
node vaultDirectFlow.js deposit <humanAmount> [receiverAddress]
node vaultDirectFlow.js deploy <humanAmount> <strategyAddress>
node vaultDirectFlow.js approve-return <humanAmount>
node vaultDirectFlow.js return <humanAmount> <strategyAddress>
node vaultDirectFlow.js redeem <humanShareAmount> [receiverAddress]
node vaultDirectFlow.js profit-demo <depositHuman> <deployHuman> <returnHuman>
```

Useful environment variables:

```bash
NODE_URL=https://app.testnet.strato.nexus
VAULT_ADDRESS=8c0f17df514efaee2baf1e59923fff700c5ca2b7
ACTOR_ADDRESS=<optional-explicit-actor>
ACCESS_TOKEN=<optional-bearer-token>
```

## Live Test Sequence We Ran

We exercised the live testnet vault at `8c0f17df514efaee2baf1e59923fff700c5ca2b7`
using direct calls.

### Simple successful flow

Using the admin address as a temporary strategy:

1. approve underlying to vault
2. deposit `0.01 ETH`
3. deploy `0.005 ETH`
4. approve returned underlying
5. return `0.006 ETH`
6. redeem `0.01` shares

Observed result:
- `CapitalReturned` recognized `0.005 ETH` principal repayment and `0.001 ETH`
  realized profit
- redeeming `0.01` shares returned `0.011 ETH`

### Multi-depositor / queue flow

We then used a helper depositor contract as a second actor and ran:

1. fund helper with `0.01 ETH`
2. helper approves vault
3. helper deposits `0.01 ETH`
4. admin deposits additional `ETH`
5. deploy most idle capital away
6. helper calls `redeemOrQueue(...)`
7. return liquidity
8. call `processQueue(...)`
9. claim processed assets

## Perceived Anomaly

The queue path is not obviously broken for a proper nonzero request id:
- a later admin withdrawal request was created as `requestId = 1`
- `processQueue(...)` processed that request
- `claim(...)` then succeeded

However, state cleanup after queue activity looks suspicious. In live state we
observed combinations such as:

- stale `requests[0]` / `requestOwner[0]` residue remaining
- `queueHead = 1` while `queueTail = 0`
- `totalQueuedShares > 0` after processed-and-claimed activity
- partially cleared-looking request mapping rows

So the current concern is not simply "queue never works", but rather that queue
metadata cleanup and invariants may be inconsistent after mixed immediate and
queued withdrawal activity.
