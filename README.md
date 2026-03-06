[![STRATO Mercata logo](https://strato.nexus/images/strato.nexus/2025.10.11/strato-logo.png)](https://strato.nexus)

# STRATO Platform

***NOTE:** README is WIP*

## Prerequisites

- Stack (build time dependency) - https://docs.haskellstack.org/en/stable/install_and_upgrade/#__tabbed_3_2
- Docker with Compose plugin (runtime-only dependency) - https://docs.docker.com/engine/install/
- Library dependencies:
  - OPTION A: Install libraries system-wide (for additional details refer to `install_deps.sh`) 
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
      
    - Macos (requires `homebrew` - https://brew.sh/):
      ```
      brew install --quiet \
        leveldb \
        libpq \
        libsodium \
        pkgconf \
        secp256k1 \
        xz
      ```
  - OPTION B: Install Nix and use the predefined packages (no need to install manually system-wide):
    - Install Nix - https://nix.dev/install-nix.html

## Build

-  Build everything:
    - OPTION A (with system-wide libraries):
      ```
      make
      ```
    - OPTION B (with Nix):
      ```
      NIX=true make
      ```
- Only build one application (e.g. mercata-backend):
    ```
    <CONFIG_VARS> make mercata-backend
    ```

- Only generate docker-compose YAMLs (will overwrite the existing):
    ```
    <CONFIG_VARS> make docker-compose
    ```

## Run

### Locally:
- Start:
    ```
    ./start my_node_name
    ```
- Wipe:
  ```
  ./forceWipe
  rm -rf my_node_name/
  ```
  
### Dockerized:
- Start:
  - `cp docker-compose.allDocker.yml bootstrap-docker/docker-compose.yml`
  - `cd bootstrap-docker`
  - Update `strato-run.sh` with your credentials:
    ```
    NODE_HOST='localhost' \
    network='helium' \
    OAUTH_CLIENT_ID='localhost' \
    OAUTH_CLIENT_SECRET='client-secret-here' \
    ./strato
    ```
    - Use `network='helium'` for testnet
    - Use `network='upquark'` for mainnet
  - `sudo ./strato-run.sh`

- Wipe:
  ```
  cd bootstrap-docker
  sudo ./strato --wipe
  ```

## Git Hooks

### Pre-commit: Trailing Whitespace Removal

A pre-commit hook is available to automatically remove trailing whitespaces before committing.

**Installation:**

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

The hook uses `scripts/delete-trailing-whitespaces.sh --staged` to process only
staged files and automatically re-stages them after cleaning.
