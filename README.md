[![STRATO Mercata logo](https://strato.nexus/images/strato.nexus/2025.10.11/strato-logo.png)](https://strato.nexus)

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

> To obtain the credentials for your node server, submit a request for client credentials at https://support.blockapps.net


Start the node:

```
<OPTIONAL_ENV_VARS> strato-up mynode --network=helium --nodeHost=example.com --sslDir='/path/to/ssl'
```

- `/path/to/ssl` should contain `server.pem` and `server.key` directly (no subdirectories), with read permissions for all users (`chmod 444 server.*`).
- Do not include OAUTH variables in env vars. You can include app-related variables if needed (e.g., RPC URLs, etc.).
- Use `--network=helium` for testnet or `--network=upquark` for mainnet (default).

### 4. Update App on a Running Node

To rebuild and redeploy only the app services (mercata-backend and mercata-ui) without resyncing the blockchain data:

```
make app
```

This builds both app images and prints the command to deploy them. Then stop and restart the node with the new images:

```
strato-down
strato-up mynode --update-app mercata-backend:<tag> mercata-ui:<tag>
```

Use the exact image tags printed by `make app`. You can also rebuild and deploy the images individually with `make mercata-backend` or `make mercata-ui`.

### 5. Stop and Wipe

Stop the node:

```
strato-down
```

Stop and wipe all data:

```
strato-down
rm -rf mynode
```
