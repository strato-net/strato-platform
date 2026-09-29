# Install a Node

This guide builds STRATO from source and starts a node with `strato-up`. Check the [requirements](requirements.md) first.

## 1. Clone the repository

```bash
git clone https://github.com/strato-net/strato-platform
cd strato-platform
```

Releases are tagged `MAJOR.MINOR`, for example `19.1`. To build a specific release, check out its tag:

```bash
git checkout 19.1
```

## 2. Install dependencies

```bash
./install_deps.sh
```

On Linux, activate the new `docker` group membership in your shell, then confirm that Docker works without `sudo`:

```bash
newgrp docker
docker ps
```

## 3. Build

```bash
make
```

For a Nix-based build, use `NIX=true make` instead.

!!! warning "Run as a regular user, not root"
    Do not run `make` or any `strato-*` command as root or with `sudo`.

`make` does three things:

1. It compiles the STRATO executables, including `strato-setup`, `convoke` and the node processes. It installs them and the `strato-*` scripts to `~/.local/bin`.
2. It installs a BIP-39 word list to `~/.local/share/strato/`.
3. It builds the node's Docker images: nginx, apex, smd, postgrest, prometheus, app-backend, app-ui, local-auth, bridge and tracking.

If `~/.local/bin` is not on your `PATH`, `make` prints a note. Run `source ~/.profile` or open a new terminal.

## 4. Store your OAuth credentials

Skip this step if you will run the node with `--localAuth`.

Run `strato-login` once:

```bash
strato-login
```

It prompts for three values:

| Prompt | Value |
|---|---|
| OAuth Discovery URL | Press Enter for the default, `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration` |
| OAuth Client ID | The client ID you received from [support.blockapps.net](https://support.blockapps.net) |
| OAuth Client Secret | The client secret |

The credentials are saved to `~/.secrets/strato_credentials.yaml` with mode `600`. `strato-setup` copies them into each new node directory. To replace them, run `strato-login --force`.

!!! note
    Don't pass OAuth client credentials as environment variables. `strato-login` is the supported path.

## 5. Start the node

=== "Mainnet (upquark)"

    ```bash
    strato-up mynode --sslDir=/path/to/ssl --snapshot
    ```

=== "Testnet (helium)"

    ```bash
    strato-up mynode --network=helium --sslDir=/path/to/ssl --snapshot
    ```

Notes on the command:

- **Node directory.** `mynode` is the node directory. It must be the first argument.
- **Network.** `--network` defaults to `upquark`, the production mainnet. See [Networks](../platform/networks.md).
- **Snapshot.** `--snapshot` restores the latest published snapshot for the network, so the node doesn't replay the chain from genesis. This is recommended. To pick a specific snapshot, add a timestamp: `--snapshot=YYYYMMDD-HH:mm:ssZ`.
- **Flag format.** Write flags as `--flag=value`. `strato-up` reads `--network=<name>` in that form to choose which snapshot to restore.
- **Other flags.** For every other flag, see [Configuration](configuration.md).

!!! note "Flags only apply to a new node directory"
    Flags only take effect when the node directory is created. If `mynode` already exists, `strato-setup` ignores the flags and `strato-up` ignores `--snapshot`. Both print a warning.

### What `strato-up` does

1. **Setup.** `strato-setup` creates `mynode/` and fills it with the generated files:
    - `.ethereumH/ethconf.yaml`
    - `secrets/`
    - `docker-compose.yml`
    - `commands.txt`
    - `genesis.json`
    - the data directories

    It also fetches the node's key from the Vault, creating the key if none exists. Finally it records `mynode` as the default node, so `strato-ps` and `strato-down` work without arguments.
2. **Snapshot restore (with `--snapshot`).** `strato-snapshot` downloads the archive over HTTPS from the public `strato-snapshots` bucket. It verifies the archive's SHA-256 checksum, then loads the archive into the node.
3. **Start.** `convoke` starts in the background. It runs `docker compose -p strato up -d --wait`, then launches the node processes listed in `commands.txt`. Its output goes to `mynode/logs/convoke.log`.

With `--localAuth`, `strato-up` then creates the first admin user:

- It prompts for a password.
- It asks you to generate or restore a BIP-39 recovery phrase. That phrase also restores the node's operator identity, so write it down.

See [Identity and Vault](../platform/identity-and-vault.md#local-auth).

## 6. Verify

### Node status

```bash
strato-ps
```

`strato-ps` shows sync progress, then each processing layer's block position:

- `sequencer`
- `vm`
- `indexed`
- `cirrus`
- `world`, the highest block your peers report

After that it lists the Docker containers and the processes run by `convoke`. The sync line reads `Sync: syncing, N% ...` until it changes to `Sync: synced`.

### Health endpoint

```bash
curl -s https://<host>/health
```

Check these fields:

- **`healthStatus`:** one of `HEALTHY`, `SYNCING`, `UNHEALTHY` or `SYNC STALLED`.
- **`lastBlock.number`:** the node's latest block.
- **`nodeAddress`:** the node's address.
- **`pbftData.is_validator`:** whether this node is currently a validator.

### Network identity

```bash
curl -s https://<host>/strato-api/eth/v1.2/metadata
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://<host>/rpc
```

The metadata response includes `networkName`, `networkID`, `chainId` and `isSynced`. `eth_chainId` returns `0x7030addddcf2` on mainnet and `0xb165855668ca` on testnet.

### Web interfaces

- The STRATO app: `https://<host>/`
- The STRATO Management Dashboard (SMD): `https://<host>/smd/`

## Next steps

- [Operations](operations.md): logs, stop and start, upgrades and troubleshooting
- [Configuration](configuration.md): all `strato-up` flags and environment variables
