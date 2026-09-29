# Networks

A STRATO node joins the network named by `--network`. Each network has these properties built into the node:

- its bootnodes
- its genesis block
- its fork heights

## Public networks

| | Mainnet | Testnet |
|---|---|---|
| Network name (`--network`) | `upquark` (default) | `helium` |
| Role | Production | Public testnet |
| `networkID` | `33056204878082667` | `114784819836269` |
| EIP-155 chain ID | `0x7030addddcf2` (`123354377739506`) | `0xb165855668ca` (`195049586845898`) |
| App | [app.strato.nexus](https://app.strato.nexus) | [app.testnet.strato.nexus](https://app.testnet.strato.nexus) |
| Public JSON-RPC | `https://noderpc.strato.nexus/rpc`, `https://app.strato.nexus/rpc` | `https://app.testnet.strato.nexus/rpc` |
| Block explorer | [stratoscan.strato.nexus](https://stratoscan.strato.nexus) | [stratoscan.testnet.strato.nexus](https://stratoscan.testnet.strato.nexus) |
| Monitor | `https://monitor.strato.nexus` | `https://monitor.testnet.strato.nexus` |

The source code also defines `lithium`, a local development network with no bootnodes (`networkID` `30515246173615469`). Other names in the source, such as `mercata`, `mercata-hydrogen` and `blockappsnet`, are legacy networks.

### How the IDs are derived

**Network ID.** The `networkID` is the network name's ASCII bytes read as one big-endian integer. Peers use it to recognize each other.

- `upquark`'s ID is larger than JavaScript's `Number.MAX_SAFE_INTEGER`, so handle it as a string.
- `net_version` returns it as a string.

**Chain ID.** The EIP-155 chain ID is the first 6 bytes (48 bits) of `keccak256(networkName)`. It is small enough for wallets and JavaScript. `eth_chainId` returns it in hex.

To check which network a node is on, use either of these:

```bash
curl -s https://app.strato.nexus/strato-api/eth/v1.2/metadata
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://noderpc.strato.nexus/rpc
```

The metadata response includes these fields:

- `networkName`, `networkID` and `chainId`
- `isSynced`
- `validators`
- `urls`, which lists the OAuth discovery URL, the Vault and the monitor the node uses

## Bootnodes and discovery

Each public network has a fixed list of bootnode IP addresses compiled into the node (`strato/core/strato-networks/src/Blockchain/Network.hs`):

- `upquark`: five bootnodes
- `helium`: four bootnodes

Discovery and peering then work like this:

1. **Seeding.** On start-up, `ethereum-discover` loads the bootnodes into the node's peer database.
2. **Discovery.** It runs devp2p-style discovery over UDP port 30303. It keeps asking for peers until it knows `--minPeers` of them (default 10).
3. **Sync.** `strato-p2p` connects to peers over TCP port 30303, up to `--maxConn` connections (default 20), and syncs blocks.

Both ports must be reachable (see [Requirements](../node/requirements.md#network)).

## Genesis

`strato-setup` generates `genesis.json` for the selected network when it creates a node directory. It builds the file from Haskell templates (`strato/core/strato-genesis`):

- **`upquark` and `helium`** share a template. Each fills it with its own initial validators, admins, bridge configuration and relayer accounts.
- **`lithium`** has a separate template.
- **Pre-placed files** take priority: if a `genesis.json` already sits in the node directory, setup uses it instead.

Genesis pre-deploys the platform's system contracts:

| Address | Contract | Role |
|---|---|---|
| `0x100` | `MercataGovernance` (proxy; initial logic at `0xff`) | Validator set and network admins (see [Consensus](consensus.md)) |
| `0x100c` | `AdminRegistry` | Owner of the platform contracts and the only initial admin of `MercataGovernance` |
| `0x100d` | `FeeCollector` | Receives transaction fees |
| `0x100e` | `Voucher` | Fee vouchers |
| `0x720` | `UserRegistry` | Username to `User` contract registry (see [Identity and Vault](identity-and-vault.md)) |
| `0xDEC1DE` | Decider | Entry point that charges each transaction's fee |
| `0xDEC1DE02` | `DeciderState` | Points to the current fee implementation |

Genesis also deploys the Mercata DeFi contracts:

- `LendingPool`, `LiquidityPool`, `CollateralVault`, `PoolConfigurator` and `LendingRegistry`
- `CDPEngine`, `CDPRegistry`, `CDPVault` and `CDPReserve`
- `MercataBridge`
- `PoolFactory` and `TokenFactory`
- `RewardsChef` and `SafetyModule`
- the initial tokens and swap pools

The node treats USDST (`0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010`) as the chain's native token. For fees, see [Transactions and Fees](transactions-and-fees.md).

## Fork heights

Some changes alter consensus: block headers, receipts, or how contract source is parsed. These changes must switch on at the same block on every node, so they are gated by block height.

- **New networks** use every rule from genesis.
- **`helium` and `upquark`** keep the old behavior below each fork height.

Most fork heights are defined in `strato/core/vm-tools/src/Blockchain/Forks.hs`. A few older SolidVM forks live next to the code they gate.

| Change | `helium` | `upquark` | Other networks |
|---|---|---|---|
| SolidVM pass-by-reference semantics | 33,918 | Genesis | Genesis |
| Receipts root in block headers | 250,000 | 1,000,000 | Genesis |
| Block-reward event included in the block's first receipt | 300,000 | 1,000,000 | Staking activation height |
| SolidVM Solidity operator precedence | Not scheduled | Not scheduled | Genesis |

Staking activation is set per network in `ethconf.yaml` (`networkConfig`), with these defaults:

| Setting | `helium` | `upquark` | `lithium` | New networks |
|---|---|---|---|---|
| `stakingActivationBlock`: stake-weighted proposer selection and votes | 250,000 | 1,000,000 | Not scheduled | Genesis |
| `stakingEventsFromGovernanceBlock`: stake weights read from `MercataGovernance` | 300,000 | 1,000,000 | Not scheduled | Genesis |

"Not scheduled" is a sentinel height that no real chain reaches.

!!! warning
    Every node on a network must use the same fork and activation heights. Don't override `--stakingActivationBlock` on a public network.

## Domains

| Domain | Use |
|---|---|
| `app.strato.nexus`, `app.testnet.strato.nexus` | STRATO app and public node APIs |
| `noderpc.strato.nexus/rpc` | Public mainnet JSON-RPC |
| `stratoscan.strato.nexus`, `stratoscan.testnet.strato.nexus` | Block explorer |
| `monitor.strato.nexus`, `monitor.testnet.strato.nexus` | Network monitor |
| `docs.strato.nexus` | This documentation |
| `go.strato.nexus` | Tracking links |

Shared services still run on `blockapps.net`:

- **`keycloak.blockapps.net`:** the OIDC provider, realm `mercata`.
- **`vault.blockapps.net:8093`:** the shared Vault and the node default. The public testnet app's metadata reports its own Vault, `vault-test.blockapps.net:8093`.
- **`support.blockapps.net`:** where you request OAuth client credentials.
