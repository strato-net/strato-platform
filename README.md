[![STRATO logo](https://strato.nexus/images/strato.nexus/2025.10.11/strato-logo.png)](https://strato.nexus)

# STRATO Platform

## Build and Run STRATO

### 1. Install Dependencies

```
git clone https://github.com/strato-net/strato-platform
cd strato-platform
```

Choose one of the following options to install dependencies:

- **OPTION A (recommended):** (Supported OS: Ubuntu 24.04, Amazon Linux 2023, macOS, Linux Mint) Run the install script which installs all dependencies automatically (Stack, Docker, libraries):
  ```
  ./install_deps.sh
  ```
- **OPTION B:** Install dependencies manually:
  - [Stack](https://docs.haskellstack.org/en/stable/install_and_upgrade/#__tabbed_3_2) (build time)
  - [Docker with Compose plugin](https://docs.docker.com/engine/install/) (build+runtime)
    - Docker should run as a non-root user. Add your user to the docker group:
      ```
      sudo groupadd docker ; sudo usermod -aG docker $USER && newgrp docker ; docker ps
      ```
      For more information, refer to the [Docker post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/).
  - Libraries:
    - Ubuntu 24.04:
      ```
      sudo apt install -y \
        libleveldb-dev \
        liblzma-dev \
        libpq-dev \
	librdkafka-dev \
        libsecp256k1-dev \
        libsodium-dev \
        pkg-config \
        postgresql-client \
        zlib1g-dev
      ```
    - macOS — choose one:
      - Install libraries system-wide using [Homebrew](https://brew.sh/):
        ```
        brew install --quiet \
          leveldb \
          postgresql \
          libsodium \
          pkg-config \
          secp256k1 \
          xz
        ```
      - Use [Nix](https://nix.dev/install-nix.html): Install Nix and use the predefined packages in an isolated path (no need to install libraries system-wide)

### 2. Build

> **Important:** Do not run the build or deploy commands under the root user or with the `sudo` prefix — this prevents permission issues.

```
make
```

For Nix-based builds, use `NIX=true make` instead.

### 3. Run

Login before the very first run:

```
strato-login
```

> To get the credentials for your node server, submit a request for client credentials at https://support.blockapps.net


Start the node:

```
<OPTIONAL_ENV_VARS> strato-up mynode --network=helium --nodeHost=example.com --sslDir='/path/to/ssl'
```

- `/path/to/ssl` should contain `server.pem` and `server.key` directly (no subdirectories), with read permissions for all users (`chmod 444 server.*`).
- Do not include OAUTH variables in env vars. You can include app-related variables if needed (e.g., RPC URLs, etc.).
- Use `--network=helium` for testnet or `--network=upquark` for mainnet (default).

### 4. Stop and Wipe

Stop the node:

```
strato-down
```

Stop and wipe all data:

```
strato-down
rm -rf mynode/
```

### 5. Patch App on a Running Node (for development and testing)

Steps to rebuild and patch the app on a running STRATO node.

#### Rebuild the App Images

```
make app
```

This builds both app images and prints the command to deploy them (similar to `make` but only builds the app)

#### Patch the App on a Node

Update the `app-backend` and `app-ui` image tags in the node's `docker-compose.yml`:

```
strato-patch-app mynode app-backend:<tag> app-ui:<tag>
```

Use the exact image tags printed by `make app`.

How the new images take effect depends on whether the node is currently running:

- **Node is not running:** `strato-patch-app` only rewrites the image tags in `docker-compose.yml`. The new images will be picked up automatically on the next `strato-up`.
- **Node is running:** the script will print a follow-up command. To apply the new images on the live node, either:
  - Re-run docker compose up for just the app services, **reusing the same ENV VARS from your original run script** (e.g. `run.sh`), so the recreated containers get the same environment they were originally launched with:
    ```
    <ENV VARS> docker compose -p strato up -d --no-deps app-backend app-ui
    ```
  - Or restart the full node without wiping its data:
    ```
    strato-down && ./run.sh
    ```

### 6. Restore a Synced Node Snapshot

For local development that requires a STRATO node, restore a pre-synced snapshot instead of syncing from genesis. The simplest path is to start a node directly from the latest published snapshot for the network:

```
strato-up mynode --network=helium --snapshot
```

`--snapshot` downloads the latest snapshot for the network; append a timestamp (`--snapshot=YYYYMMDD-HH:mm:ssZ`) to pick a specific one. To restore without starting, or to restore from an explicit location:

```
# Latest published snapshot for the network:
strato-snapshot restore mynode --snapshot --network helium

# An explicit local file or S3 URI:
strato-snapshot restore mynode \
  --source s3://strato-snapshots/helium/latest.tar.zst \
  --network helium

strato-up mynode
```

Snapshot artifacts are cold copies of `.ethereumH`, Postgres, Redis, and Kafka state. See `design-documents/node-snapshot-tool-README.md` for the full CLI and `design-documents/node-snapshot-dev-loop.md` for the create/restore contract and safety checks.
