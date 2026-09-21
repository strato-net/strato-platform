# Node Configuration

A node is configured once, when `strato-up` (through `strato-setup`) creates its directory:

- **Command-line flags** set the node's settings.
- **A few environment variables** cover secrets, runtime tuning and optional app settings.

If the directory already exists, `strato-setup` ignores all flags and prints a warning. To change a flag, create a new node directory (see [Operations](operations.md#clean-restart)).

## Flags

Write flags as `--flag=value`, after the node directory:

```bash
strato-up mynode --network=helium --sslDir=/path/to/ssl --snapshot
```

### Common flags

| Flag | Default | Meaning |
|---|---|---|
| `--network` | `upquark` | Network to join: `upquark` (mainnet), `helium` (testnet) or `lithium` (local development, no bootnodes). See [Networks](../platform/networks.md). |
| `--sslDir` | *(empty)* | Directory holding `server.pem` and `server.key`. Setting it enables HTTPS on 443 and redirects HTTP to HTTPS. |
| `--localAuth` | `false` | Use the bundled identity provider (Ory Kratos and Hydra) and a node-local Vault instead of external Keycloak and the shared Vault. |
| `--httpPort` | `8081` | nginx HTTP port. |
| `--vaultUrl` | `https://vault.blockapps.net:8093/strato/v2.3` | Vault that holds the node key and user keys. Ignored with `--localAuth`, which uses the node-local Vault. |
| `--vaultTimeoutSec` | `12` | HTTP response timeout, in seconds, for Vault key and signature requests. |
| `--jsonrpc` | `true` | Run the Ethereum JSON-RPC server (`ethereum-jsonrpc`, port 8545) and expose it at `/rpc`. |
| `--publicStratoRpc` | `false` | Allow the `strato_*` simulation and trace methods on the public `/rpc` endpoint. |
| `--generateKey` | `true` | During setup, create a node key in the Vault if none exists. When `false`, setup waits for the key to be inserted manually. |

### Snapshot flags

These flags are handled by `strato-up` itself and are not passed to `strato-setup`:

| Flag | Meaning |
|---|---|
| `--snapshot` | Restore the latest published snapshot for `--network` before starting. |
| `--snapshot=<timestamp>` | Restore a specific published snapshot. The timestamp format is `YYYYMMDD-HH:mm:ssZ`. |
| `--snapshot-source=<file-or-s3-uri>` | Restore from an explicit archive. Takes precedence over `--snapshot`. |

### Peer and transaction limits

| Flag | Default | Meaning |
|---|---|---|
| `--minPeers` | `10` | Peer count at which discovery stops looking for more peers. |
| `--maxConn` | `20` | Maximum number of P2P client connections. |
| `--connectionTimeout` | `120` | Seconds to tolerate a peer that isn't sending anything useful. |
| `--maxTxsPerBlock` | `500` | Maximum transactions in a block. |
| `--mempoolLivenessCutoff` | `60` | Maximum age, in seconds, of a transaction kept in the mempool. |
| `--gasLimit` | `1000000` | Maximum gas a transaction can use. |
| `--txSizeLimit` | `2097152` | Maximum length of an RLP-encoded transaction, in bytes (2 MiB). |

### Consensus and VM flags

| Flag | Default | Meaning |
|---|---|---|
| `--blockstanbul_block_period_ms` | `1000` | Minimum delay between block creations. |
| `--blockstanbul_round_period_s` | `3600` | Seconds without progress before a forced PBFT round change. This is only a backstop, because a missed proposal is detected within seconds. |
| `--stakingActivationBlock` | `-1` | Block from which stake-weighted proposer selection applies. `-1` means the network default. Every node of a network must agree, so don't override it on a public network. |
| `--svmTrace` | `false` | Verbose SolidVM logging. |
| `--sqlDiff` | `true` | Write account state and storage to the SQL database. |

For how the consensus settings are used, see [Consensus](../platform/consensus.md).

## ethconf.yaml

`strato-setup` writes the resolved configuration to `mynode/.ethereumH/ethconf.yaml` and makes it read-only. This file is the node's single source of truth:

- The node processes read it directly.
- It is mounted read-only into the containers at `/config/ethconf.yaml`.

Main sections:

| Section | Contains |
|---|---|
| `networkConfig` | `network`, `networkID`, `chainId`, `httpPort`, `txSizeLimit`, `gasLimit`, `blockPeriodMs`, `roundPeriodS`, and the staking activation settings |
| `urlConfig` | `nodeUrl` (from the host name), `vaultUrl`, `vaultTimeoutSec`, `cookieRealm` |
| `p2pConfig`, `discoveryConfig` | Peer limits and timeouts |
| `quarryConfig` | Block building: `maxTxsPerBlock`, `mempoolLivenessCutoff` |
| `sqlConfig`, `cirrusConfig`, `redisBlockDBConfig` | Database connections |
| `apiConfig` | `strato-api` port (`3000`) and bind address |
| `vmConfig` | `sqlDiff`, plus the transaction-simulation settings `vmJsonRpcUrl` and `simMaxConcurrent` (default `8`) |

### Node directory layout

| Path | Contents |
|---|---|
| `.ethereumH/` | `ethconf.yaml` and the node's chain databases |
| `secrets/` | `postgres_password`, `oauth_credentials.yaml`, `ssl/` (copied certificate and key); with `--localAuth`, also `vault_password` and the local-auth secrets |
| `docker-compose.yml` | The generated container definitions, pinned to the image tags of the build that created the node |
| `commands.txt` | The node processes `convoke` runs, with their runtime flags |
| `genesis.json` | The genesis block |
| `postgres/`, `redis/`, `jlog/`, `prometheus/` | Data. `jlog/` holds the embedded streaming log. |
| `logs/` | Process and container logs (see [Operations](operations.md#logs)) |

## Environment variables

All environment variables are optional.

| Variable | Read by | Effect |
|---|---|---|
| `postgres_password` | `strato-setup` | Postgres password for a new node. By default a random 32-character password is generated. |
| `STRATO_SEQUENCER_RTS`, `STRATO_VMRUNNER_RTS` | `strato-setup` | Replace the computed GHC runtime flags for `strato-sequencer` / `vm-runner`. The value is placed verbatim between `+RTS` and `-RTS`. |
| `STRATO_LOGROTATE_INTERVAL_SEC` | `strato-logrotate` | Seconds between rotation runs (default `600`). |
| `STRATO_LOGROTATE_MAX_SIZE` | `strato-logrotate` | Rotate early when a log exceeds this size (default `100M`). |
| `STRATO_LOGROTATE_MIN_SIZE` | `strato-logrotate` | Leave logs smaller than this alone at the daily rotation (default `10M`). |
| `STRATO_LOGROTATE_RETENTION_DAYS` | `strato-logrotate` | Delete rotated logs older than this (default `7`). |
| `STRATO_SNAPSHOT_BUCKET` | `strato-snapshot` | Snapshot bucket (default `strato-snapshots`). |
| `STRATO_SNAPSHOT_REGION` | `strato-snapshot` | Bucket region used to build the download URL (default `us-east-1`). |
| `STRATO_SNAPSHOT_WORKDIR` | `strato-snapshot` | Extraction directory (default `./.snapshot-work`). |
| `STRATO_SNAPSHOT_DOWNLOAD_DIR` | `strato-snapshot` | Download cache (default `./.snapshot-downloads`). |
| `LOCAL_AUTH_ADMIN_USERNAME` | `strato-up`, `strato-user-add` | First admin username with `--localAuth` (default `admin`). |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | `strato-setup` | With `--localAuth` only: fixed client credentials for the local identity provider. Random values are generated otherwise. |

Where these variables take effect:

- **`strato-setup` variables** matter only when a node directory is created.
- **`strato-logrotate` variables** are read at runtime, so set them in the environment you run `strato-up` from.
- **App variables:** the generated `docker-compose.yml` also passes app settings through from your environment, such as the `RPC_URL_*` external-chain RPC endpoints. Docker Compose substitutes them each time the containers start, so pass the same variables on every `strato-up`.

## Local auth mode

`--localAuth` makes the node self-contained for identity:

- **Identity provider.** A `local-auth` container runs Ory Kratos (users and passwords) and Ory Hydra (OAuth2 and OIDC). nginx serves it under `/auth/`.
- **Vault.** A node-local Vault (`blockapps-vault-wrapper-server`, port 8093) runs as a host process. nginx exposes it at `/vault/`. The node's `vaultUrl` points there instead of the shared Vault.
- **Secrets.** `strato-setup` generates the Vault password, the Hydra and Kratos secrets, and the OAuth client credentials into `secrets/`. `strato-login` is not needed.
- **First admin.** On the first `strato-up`, the admin user and the node's operator key are created together from a BIP-39 recovery phrase.
- **More users.** Add users with `strato-user-add` (see [Operations](operations.md#add-users-local-auth)).

!!! warning "Local-auth keys live only in the node directory"
    With `--localAuth`, the node key and user keys are stored in the node's own Postgres `oauth` database. Snapshots never include that database, so removing the node directory deletes the keys. To recover them, keep the recovery phrases.

## JSON-RPC and the STRATO RPC extensions

- **JSON-RPC server.** `--jsonrpc` (on by default) starts `ethereum-jsonrpc` and exposes it through nginx at `/rpc`.
- **Guarded methods.** On that public route, nginx rejects every `strato_*` method with HTTP 403. These are the simulation, trace and proof extensions. Standard `eth_*` methods and `debug_traceBlockByHash` are allowed.
- **Opening them up.** Start the node with `--publicStratoRpc=true` to allow the `strato_*` methods on `/rpc`. Bloc's transaction simulation endpoint is not affected by this flag.
- **Turning JSON-RPC off.** Start the node with `--jsonrpc=false` to remove the process and the `/rpc` route.

For the method reference, see [JSON-RPC](../reference/json-rpc.md).

## SSL

With `--sslDir`, `strato-setup` copies `server.pem` and `server.key` into `mynode/secrets/ssl/`, which is mounted into the nginx container.

nginx then does the following:

- It listens on 443 with TLS 1.2 and 1.3.
- It redirects requests on `--httpPort` to HTTPS.

Docker publishes both the HTTP port and 443.

Without `--sslDir`, the node serves plain HTTP on `--httpPort` only. Don't use that for a public node.
