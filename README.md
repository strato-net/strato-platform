![logo](https://www.stratomercata.com/lovable-uploads/3f84e7ae-d3e1-4921-8478-2ce97ef95cad.png)

# STRATO Mercata Platform

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
        postgresql-client
      ```
      
    - Macos (requires `homebrew` - https://brew.sh/):
      ```
      brew install --quiet \
        leveldb \
        postgresql \
        libsodium \
        pkg-config \
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
  - OPTION A (libraries installed system-wide):
    ```
    ./start my_node_name
    ```
    and follow the steps to provide the OAuth credentials etc.
  - OPTION B (nix env): the compiled executables still require some of the dependencies at run time - we'll use the nix shell with same environment from build time:
    ```
    nix-shell strato/nix/stack-integration.nix
    ./start my_node_name
    ```
- Wipe:
  ```
  ./forceWipe
  ```
  
### Dockerized:
- Start:
  - `git clone https://github.com/blockapps/strato-getting-started` (***NOTE:*** to be deprecated soon in favor of docker-compose native commands executed directly in strato-platform)
  - `cp docker-compose.allDocker.yml strato-getting-started/`
  - `cd strato-getting-started`
  - edit `strato-run.sh`, e.g. for testnet:
    ```
    NODE_HOST='localhost' \
    network='helium' \
    OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration' \
    OAUTH_CLIENT_ID='localhost' \
    OAUTH_CLIENT_SECRET='client-secret-here' \
    ./strato
    ```
  - `chmod +x strato-run.sh`
  - `sudo ./strato-run.sh`

- Wipe:
  ```
  cd strato-getting-started
  sudo ./strato --wipe
  ```
