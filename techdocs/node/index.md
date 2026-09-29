# Run a Node

A STRATO node joins a STRATO network, and it can do so as a regular syncing node or as a validator. The two public networks are:

- **upquark:** the production mainnet, and the default.
- **helium:** the public testnet.

## What a node gives you

- **Your own copy of the chain.** The node syncs blocks from its peers and re-executes every transaction in SolidVM. It then checks the results against the block headers.
- **Every STRATO API, on your own host,** all behind one nginx:

| Path | Service |
|---|---|
| `/` | The STRATO app |
| `/api/` | App backend API |
| `/bloc/v2.2/` | Bloc: contracts and transactions |
| `/strato-api/eth/v1.2/` | Core API: blocks, accounts, transactions, metadata |
| `/cirrus/search/` | Cirrus: indexed contract state |
| `/rpc` | Ethereum JSON-RPC |
| `/smd/` | The STRATO Management Dashboard |
| `/health` | Public health endpoint |

- **A path to becoming a validator.** A synced node can be admitted to the validator set (see [below](#node-types)).

## Components

`strato-up` runs a node as two groups: host processes and Docker containers.

### Host processes

A small supervisor, `convoke`, starts these processes and restarts none of them. If any one exits, `convoke` stops the whole node.

| Process | Role |
|---|---|
| `ethereum-discover` | Peer discovery on UDP 30303, seeded from the network's bootnodes |
| `strato-p2p` | Block and transaction exchange with peers on TCP 30303 |
| `strato-sequencer` | Orders transactions and runs PBFT consensus (Blockstanbul) |
| `vm-runner` | Executes transactions in SolidVM |
| `strato-indexer` | Writes chain data to Postgres and Redis |
| `slipstream` | Indexes contract state and events into the Postgres `cirrus` database |
| `strato-api` | Core API and Bloc API (port 3000) |
| `ethereum-jsonrpc` | Ethereum JSON-RPC (port 8545). On by default. |
| `strato-network-monitor` | Watches network interfaces and resets peer timeouts |
| `strato-logrotate` | Rotates the node's log files |
| `blockapps-vault-wrapper-server` | Node-local Vault, only with `--localAuth` |

The processes stream data to each other through JLog, an embedded log stored in the node directory. JLog has been the default streaming backend since 19.1, replacing Kafka.

### Docker containers

| Container | Role |
|---|---|
| `nginx` | Public entry point: TLS, OAuth/OIDC login, CSRF protection, routing |
| `app-backend`, `app-ui` | The STRATO app |
| `smd`, `apex` | The STRATO Management Dashboard and its backend. `apex` also serves `/health`. |
| `postgres` | Databases `eth` (chain data) and `cirrus` (indexed contracts) |
| `postgrest` | Read-only REST access to Cirrus at `/cirrus/search` |
| `redis` | Block cache |
| `prometheus` | Metrics |
| `docs` | Swagger UI |
| `local-auth` | Ory Kratos and Hydra identity provider, only with `--localAuth` |

## Node types

**Regular node.** Every node syncs, verifies and serves the chain. A node that is not in the validator set follows consensus but does not vote or propose.

**Validator.** A validator is identified by its node address: the address of the node key held in the Vault. That address appears as `nodeAddress` in `/health`.

A node is a validator when its address is in the validator set stored in `MercataGovernance` (the genesis contract at `0x100`). The address gets into that set in one of two ways:

- **Admin vote.** Registered network admins vote with `voteToAddValidator` / `voteToRemoveValidator`. A change passes with more than two thirds of the admins.
- **Staking.** An operator registers in `ValidatorRegistry`, which anyone may do, and binds the node's address. It bonds at least the minimum stake, a governance parameter. It then activates, subject to the set's size limits. The staking contract adds the validator to `MercataGovernance`, and removes it automatically when it stops being eligible.

`/health` reports `pbftData.is_validator` for the local node. Validators need at least 8 GB of RAM.

For details, see [Consensus](../platform/consensus.md).

## In this section

- [Requirements](requirements.md): hardware, operating systems, ports, credentials, TLS and DNS
- [Install](install.md): build from source and start with `strato-up`
- [Configuration](configuration.md): flags, `ethconf.yaml`, environment variables, local auth, JSON-RPC and SSL
- [Operations](operations.md): status, logs, restarts, upgrades, snapshots and troubleshooting

Related platform pages:

- [Networks](../platform/networks.md)
- [Consensus](../platform/consensus.md)
- [Identity and Vault](../platform/identity-and-vault.md)
