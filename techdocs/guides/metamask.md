# Add STRATO to MetaMask

Add STRATO as a custom network in MetaMask to view your USDST balance and sign legacy Ethereum transactions.

<p>
  <button type="button" class="md-button md-button--primary" id="add-strato-network" aria-describedby="add-strato-network-status" disabled>Add STRATO to MetaMask</button>
</p>
<p id="add-strato-network-status" role="status" aria-live="polite"></p>

Use a browser with [MetaMask installed](https://metamask.io/download), or open this page in MetaMask's mobile browser. You can also add the network manually using the settings below.

!!! note "Network currency and fees"
    MetaMask displays USDST as the native currency. Transactions currently use one voucher or 0.01 USDST under the standard fee policy; this may change in a future network upgrade.

## Mainnet settings

| Setting | Value |
|---|---|
| Network name | STRATO |
| RPC URL | `https://noderpc.strato.nexus/rpc` |
| Chain ID | `123354377739506` |
| Currency symbol | `USDST` |
| Block explorer URL | `https://stratoscan.strato.nexus` |

The alternate mainnet RPC URL is `https://app.strato.nexus/rpc`.

## Add the network

1. Open MetaMask's network selector and choose to add a custom network manually.
2. Enter the mainnet settings above and save the network.
3. Switch to STRATO.

Use the EIP-155 chain ID above, equivalent to `0x7030addddcf2`. Do not enter the network ID `33056204878082667`; it identifies STRATO peers and is too large for JavaScript's safe integer range.

The currency symbol follows the node's current behavior: `eth_getBalance` reads USDST, and native value transfers move USDST. STRATO is a separate token. Changing the wallet's displayed symbol does not change which token is transferred or charged.

## Testnet settings

| Setting | Value |
|---|---|
| Network name | STRATO Testnet |
| RPC URL | `https://app.testnet.strato.nexus/rpc` |
| Chain ID | `195049586845898` (`0xb165855668ca`) |
| Currency symbol | `USDST` |
| Block explorer URL | `https://stratoscan.testnet.strato.nexus` |

## Fees and compatibility

STRATO uses PBFT consensus (Blockstanbul). The default minimum block interval is one second; it is not a guaranteed average block time.

The JSON-RPC API supports legacy Ethereum transactions, not EIP-1559 transactions. Gas estimation returns a fixed 21,000 and gas price quotes approximately 0.01 USDST at that estimate. Wallet adjustments to gas can change the displayed total. Fees are charged separately through the Decider contract, using one voucher or 0.01 USDST under the standard fee policy; the quote does not account for vouchers or fee exemptions.

Adding the network does not establish that all MetaMask send flows work. End-to-end legacy-send verification remains outstanding. SolidVM contracts do not execute EVM bytecode.

See [Networks](../platform/networks.md), [JSON-RPC](../reference/json-rpc.md), [Transactions and Fees](../platform/transactions-and-fees.md) and [Consensus](../platform/consensus.md) for details.
