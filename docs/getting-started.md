# Getting Started

This guide covers the prerequisites, build process, and running instructions for STRATO Mercata Platform.

## Prerequisites

### Stack (Build Time Dependency)

Install Stack from: https://docs.haskellstack.org/en/stable/install_and_upgrade/

### Docker with Compose Plugin (Runtime Dependency)

Install Docker from: https://docs.docker.com/engine/install/

### Library Dependencies

You have two options for installing library dependencies:

#### Option A: System-wide Installation

**Ubuntu 24.04:**
```bash
sudo apt install -y \
  libleveldb-dev \
  liblzma-dev \
  libpq-dev \
  libsecp256k1-dev \
  libsodium-dev \
  postgresql-client
```

**macOS (requires Homebrew):**
```bash
brew install --quiet \
  leveldb \
  postgresql \
  libsodium \
  pkg-config \
  secp256k1 \
  xz
```

#### Option B: Nix

Install Nix from: https://nix.dev/install-nix.html

The project includes predefined Nix packages, so no manual library installation is needed.

## Download

The strato platform currently lives in a monorepo at:
```bash
git clone git@github.com:blockapps/strato-platform.git
```

*Note: Prior to the open sourcing of the strato platform, the following alternative repo should be used to access published builds:*

Download [strato-getting-started](https://github.com/blockapps/strato-getting-started)

```bash
git clone https://github.com/blockapps/strato-getting-started.git
```

## Build

### Build Everything

**With system-wide libraries:**
```bash
make
```

**With Nix:**
```bash
NIX=true make
```

### Build Single Application

To build only one application (e.g., mercata-backend):
```bash
<CONFIG_VARS> make mercata-backend
```

### Generate Docker Compose Files

To generate docker-compose YAMLs (overwrites existing):
```bash
<CONFIG_VARS> make docker-compose
```

## Run

### OAUTH Client Credentials
In order to obtain `OAUTH_DISCOVERY_URL`, `OAUTH_CLIENT_ID`, and `OAUTH_CLIENT_SECRET`, you must request a keycloak client at [http://support.blockapps.net/](http://support.blockapps.net/); after signing in, see section Request Client Credentials.

### Local Development

**Start:**
```bash
./start my_node_name
```

**Wipe:**
```bash
./forceWipe
rm -rf my_node_name/
```

### Dockerized Deployment

**Start:**

1. Copy the docker-compose template:
   ```bash
   cp docker-compose.allDocker.yml bootstrap-docker/docker-compose.yml
   ```

2. Navigate to bootstrap-docker:
   ```bash
   cd bootstrap-docker
   ```

3. Update `strato-run.sh` with your credentials:
   ```bash
   NODE_HOST='localhost' \
   network='helium' \
   OAUTH_CLIENT_ID='localhost' \
   OAUTH_CLIENT_SECRET='client-secret-here' \
   ./strato
   ```

   - Use `network='helium'` for testnet
   - Use `network='upquark'` for mainnet

4. Run:
   ```bash
   sudo ./strato-run.sh
   ```

**Wipe:**
```bash
cd bootstrap-docker
sudo ./strato --wipe
