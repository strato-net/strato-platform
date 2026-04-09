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
