# Building Apps on STRATO

STRATO is a public blockchain that works with standard Ethereum tooling.

- **SolidVM** runs smart contracts written in Solidity. STRATO has no separate EVM engine.
- **PBFT consensus** among validators orders the blocks.
- **Built-in APIs on every node**: an Ethereum JSON-RPC endpoint, REST APIs for transactions and DeFi operations, and **Cirrus**, which indexes contract state and events into Postgres. Most apps don't need to run their own indexer.

You can use the public endpoints below without running a node.

## Networks

| | Mainnet (upquark) | Testnet (helium) |
|---|---|---|
| App and API host | `https://app.strato.nexus` | `https://app.testnet.strato.nexus` |
| JSON-RPC | `https://app.strato.nexus/rpc`, `https://noderpc.strato.nexus/rpc` | `https://app.testnet.strato.nexus/rpc` |
| Chain ID (`eth_chainId`) | `123354377739506` (`0x7030addddcf2`) | `195049586845898` (`0xb165855668ca`) |
| Network ID (`net_version`) | `33056204878082667` | `114784819836269` |

More detail: [Networks](../platform/networks.md).

## API surface

Every node serves these paths from the same host.

| Path | What it is | Auth |
|---|---|---|
| `/rpc` | Ethereum JSON-RPC | None. `strato_*` methods are blocked on public endpoints. |
| `/cirrus/search/*` | Cirrus, a PostgREST API over indexed contract state (`GET` only) | None for reads |
| `/strato-api/eth/v1.2/*` | Core API: accounts, blocks, transactions, and submitting signed transactions | None |
| `/bloc/v2.2/*` | Bloc: call contract functions by name with JSON arguments, get results, simulate | Reads, `/transactions/results`, `/transaction/unsigned` and `/transaction/simulate` are open. `POST /transaction` and `/transaction/parallel` sign with your Vault key, so they need an OIDC token. |
| `/api/*` | App backend: tokens, swaps, CDP, lending, bridge, rewards, staking | Public reads are open. User data and all writes need an OIDC token. |

References: [Core Platform API](../reference/strato-node-api.md), [Cirrus](../reference/cirrus.md), [JSON-RPC](../reference/json-rpc.md). The app backend's OpenAPI spec is at `/api/public/api-docs.json`, and its Swagger UI is at `/api/docs` (log in through the browser).

## Integration options

| Option | Who signs | Use it for |
|---|---|---|
| **A. App REST API** (`/api`) | Your STRATO account's Vault key, server-side | Backend services that use STRATO's DeFi features without building transactions |
| **B. Bloc** (`/bloc/v2.2`) | Your STRATO account's Vault key, server-side | Calling any contract function by name with JSON arguments |
| **C. JSON-RPC** (`/rpc`) with viem or ethers | Your own private key | Self-custody bots, scripts and dApps |
| **D. Cirrus** (`/cirrus/search`) | Nobody (read-only) | Indexed state, mappings and events |
| **E. External wallets** (STRATO Wallet, MetaMask) | The user's wallet | Browser dApps |

Options A and B use an OAuth 2.0 / OIDC access token from Keycloak (realm `mercata`). Request client credentials at [support.blockapps.net](https://support.blockapps.net). See the [Integration Guide](integration.md) for each option.

!!! info "Fees are paid in USDST, not ETH"
    Every transaction costs **0.01 USDST**, or **one voucher** if the sender holds one. The fee is charged before execution, so reverted transactions still pay. There is no gas price to tune. A batch of N transactions costs N fees, so an approve followed by an action costs 0.02 USDST. See [Transactions and Fees](../platform/transactions-and-fees.md).

## Key concepts

- **Accounts.** An OIDC user gets a custodial signing key in Vault on their first authenticated request. Alternatively, you can hold your own key and sign locally. See [Identity and Vault](../platform/identity-and-vault.md).
- **Contracts.** SolidVM executes Solidity source. Token contracts implement the ERC-20 functions, so standard ERC-20 ABIs work over JSON-RPC. See [SolidVM](../solidvm/index.md).
- **Addresses.** Cirrus and the REST APIs return 40 hex characters without `0x`. JSON-RPC tools expect the `0x` prefix.
- **Amounts.** Contract arguments are integers in the token's base units. The genesis tokens use 18 decimals.
- **System contracts.** Governance, fees and the core DeFi contracts have fixed genesis addresses. See [Contract Addresses](contract-addresses.md).

## Reference implementation

The STRATO web app in this repository uses every integration option:

- `app/backend/src/utils/txBuilder.ts`: builds Bloc `FUNCTION` transactions and checks fee coverage
- `app/backend/src/utils/txHelper.ts`: submits transactions and polls `/bloc/v2.2/transactions/results`
- `app/backend/src/utils/appApiHelper.ts`: API clients for Bloc, Cirrus and the core API
- `app/backend/src/api/services/`: per-feature transaction logic (tokens, CDP, lending, swaps, bridge, rewards, staking)
- `app/ui/src/pages/Transfer.tsx`: an external-wallet token transfer signed as a legacy transaction
- `app/contracts/concrete/`: the DeFi contracts

The STRATO Wallet browser extension lives in its own repository,
[strato-net/strato-wallet](https://github.com/strato-net/strato-wallet).

## Run your own node

Public endpoints cover most use cases. To run a node, see [Run a Node](../node/index.md).

## Support

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

## Next steps

- [Quick Start](quickstart.md): first read and first transaction
- [Integration Guide](integration.md): each option in detail
- [E2E Examples](e2e.md): complete scripts
- [Quick Reference](quick-reference.md): cheat sheet
