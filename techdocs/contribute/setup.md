# Setup - Contributing to STRATO

This page covers how to build STRATO from source, run a local node, and work on the app layer.

---

## Who is This For?

**You're in the right place if you want to:**

- Change the blockchain core (Haskell, `strato/`)
- Write or test the platform's smart contracts (SolidVM, `app/contracts/`)
- Work on the app backend (`app/backend/`) or UI (`app/ui/`)
- Work on off-chain services (`app/services/`) or node tooling

**Not what you're looking for?**

- Building apps that use STRATO? See [Building Apps on STRATO](../build-apps/overview.md).
- Running a node without changing code? See [Run a Node](../node/index.md).

---

## Prerequisites

`install_deps.sh` supports these platforms:

- macOS Sequoia (15.x) and Tahoe (26.x)
- Ubuntu 24.04 LTS and 26.04 LTS
- Amazon Linux 2023
- Oracle Linux 8.10

You need:

- **git**
- **Docker** with the Compose plugin. On Linux, run Docker as your own user (member of the `docker` group), not as root.
- **Haskell Stack**. The compiler version comes from `strato/stack.yaml`.
- **System libraries**: LevelDB, secp256k1, libsodium, libpq, librdkafka, xz/lzma, GMP, zlib, and `logrotate`.
- **Node.js 22.12 or later, below 23**, only if you run the app backend or UI outside Docker. Both `app/backend/package.json` and `app/ui/package.json` declare `"node": ">=22.12 <23.0"`.
- **OAuth client credentials** to run a node against the shared Keycloak. Request them at [support.blockapps.net](https://support.blockapps.net/). You don't need them if you run the node with `--localAuth` (see [Log in](#4-log-in)).

---

## 1. Clone the Repository

```bash
git clone https://github.com/strato-net/strato-platform
cd strato-platform
```

If you plan to open pull requests, fork the repository first. See [Contributing Guidelines](contributing.md).

---

## 2. Install Dependencies

=== "Install script (recommended)"

    ```bash
    ./install_deps.sh
    ```

    The script installs git, Docker, Stack and the system libraries. On Linux it also adds your user to the `docker` group. To use that group in your current shell, run:

    ```bash
    newgrp docker
    docker ps
    ```

    On Amazon Linux 2023 and Oracle Linux 8.10, the script builds LevelDB, secp256k1 and librdkafka from source.

=== "Manual (Ubuntu)"

    Install [Stack](https://docs.haskellstack.org/en/stable/install_and_upgrade/) and [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/ubuntu/). Then add your user to the `docker` group:

    ```bash
    sudo groupadd docker ; sudo usermod -aG docker $USER && newgrp docker ; docker ps
    ```

    Install the libraries that `install_deps.sh` installs:

    ```bash
    sudo apt install -y --no-install-recommends \
      build-essential curl libgmp-dev zlib1g-dev \
      libleveldb-dev liblzma-dev libpq-dev librdkafka-dev \
      libsecp256k1-dev libsodium-dev logrotate postgresql-client
    ```

=== "Manual (macOS)"

    Install [Homebrew](https://brew.sh/) and Docker Desktop. Then install:

    ```bash
    brew install --quiet git haskell-stack
    brew install --quiet \
      gmp leveldb libpq librdkafka libsodium logrotate pkgconf secp256k1 xz
    ```

=== "Nix"

    Install [Nix](https://nix.dev/install-nix.html) and Docker. Build with `NIX=true make` (see below). This passes `--nix` to Stack, which uses `strato/nix/stack.nix` to provide the libraries, so you don't install them system-wide.

!!! note "librdkafka"
    The default node no longer runs Kafka (19.1 uses embedded JLog streaming). The Kafka streaming backends are still in the Stack build, so librdkafka is still a build dependency.

---

## 3. Build

!!! warning "Do not use root or sudo"
    Run `make`, `strato-login` and `strato-up` as your normal user. Running them as root causes permission problems.

```bash
make
```

With Nix:

```bash
NIX=true make
```

The default target does the following:

1. Writes `BUILD_METADATA`: the version plus a content hash for each image.
2. Runs `stack install` in `strato/`. This installs every Haskell executable to `~/.local/bin`, including `strato-setup`, `convoke`, the node processes and `solid-vm-cli`.
3. Installs the `bin/` scripts to `~/.local/bin`: `strato-login`, `strato-up`, `strato-down`, `strato-ps`, `strato-patch-app`, `strato-user-add`, `strato-snapshot` and `strato-logrotate`.
4. Builds these Docker images: apex, nginx, postgrest, prometheus, smd, app-backend, app-ui, bridge, bridge-nginx, tracking, tracking-nginx, tracking-ui and local-auth.

Each image is tagged with the version and a hash of its source directory. `make` skips any image whose tag already exists, so later builds only rebuild what changed. Local Haskell packages compile with `-Wall -Werror`, so any warning fails the build.

If `~/.local/bin` is not on your `PATH`, `make` prints a note. Run `source ~/.profile` or open a new terminal.

### Useful Make targets

| Target | What it does |
|--------|--------------|
| `make` | Builds everything listed above (target `local`) |
| `make app` | Builds only the `app-backend` and `app-ui` images, then prints a `strato-patch-app` command |
| `make nginx`, `make apex`, `make smd`, `make app-ui`, ... | Builds one image if its tag is missing |
| `make nginx-force`, `make app-ui-force`, ... | Rebuilds one image unconditionally |
| `make pretty` | Formats all tracked `.hs` files with ormolu (runs in Docker) |
| `make hoogle` | Generates and serves local Haddock/Hoogle docs for `strato/` |
| `make install-completions` | Installs shell completions for `airlock`, `baby-jubjub-cli` and `strato-barometer` |
| `make uninstall` | Removes the `strato-*` scripts, `strato-setup` and `convoke` from `~/.local/bin` |

---

## 4. Log in

Run this once per machine:

```bash
strato-login
```

It asks for three values and saves them to `~/.secrets/strato_credentials.yaml`:

- **OAuth discovery URL**. The default is `https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration`.
- **Client ID**
- **Client secret**

Use `strato-login --force` to replace saved credentials. Don't pass OAuth credentials as environment variables.

If the credentials file is missing, `strato-up` stops with `OAuth credentials not found at ~/.secrets/strato_credentials.yaml. Run 'strato-login' first.`

!!! tip "No Keycloak credentials? Use local auth"
    `strato-up mynode --localAuth` bundles Ory Hydra and Kratos plus a node-local Vault, so you don't need `strato-login`. The first run creates an admin user, named `admin` unless you set `LOCAL_AUTH_ADMIN_USERNAME`. To add users, run `strato-user-add mynode <username>`. See `local-auth/README.md` and [Identity and Vault](../platform/identity-and-vault.md).

---

## 5. Run a Local Node

Start a testnet node from the latest published snapshot. Restoring a snapshot is much faster than syncing from genesis:

```bash
strato-up mynode --network=helium --snapshot
```

`strato-up` does the following:

1. Runs `strato-setup`, which creates `mynode/` containing:
    - `.ethereumH/ethconf.yaml` (the node configuration)
    - `secrets/`
    - `genesis.json`
    - a generated `docker-compose.yml`
    - `commands.txt` (the list of native processes)
    - `logs/`
2. With `--snapshot`, restores the snapshot into the new node directory. If `mynode/` already exists, it ignores `--snapshot`.
3. Starts `convoke` in the background. `convoke` runs `docker compose -p strato up -d --wait`, then starts each line of `commands.txt` as a host process. If any process exits, convoke tears the whole node down.

Other notes:

- The network defaults to `upquark` (mainnet). Use `--network=helium` for testnet.
- nginx serves the node on `--httpPort` (default `8081`). With `--sslDir=/path/to/ssl`, which must contain `server.pem` and `server.key`, it serves on 443.
- For all flags, see [Node configuration](../node/configuration.md).

Check status and stop:

```bash
strato-ps      # status of the node
strato-down    # stop the node
```

`strato-ps` and `strato-down` default to the last node you set up. That path is stored in `~/.strato/default-node`. You can also pass a node directory, for example `strato-down mynode`.

Logs are in `mynode/logs/`:

- one file per native process, named after the command (for example `logs/vm-runner` and `logs/strato-p2p`)
- `logs/convoke.log`
- the container logs

### Clean restart

!!! warning "Always restart from a clean node directory"
    Don't start a node on top of an existing or partially stopped `mynode`. Reused state gives unreliable results, for example a stray second process. The only reliable sequence is:

    ```bash
    strato-down
    rm -rf mynode        # or: mv mynode mynode.backup
    strato-up mynode --network=helium --snapshot
    ```

    Manage the node only with `strato-down` and `strato-up`. Don't start or kill individual processes or `convoke` by hand.

---

## 6. Development Loops

### Core (Haskell)

1. Edit code under `strato/`.
2. Rebuild with `make`, or run `cd strato && stack install` if you only changed Haskell code.
3. Do a [clean restart](#clean-restart).

To build or test a single package:

```bash
cd strato
stack build slipstream
stack test slipstream
```

### Contracts (SolidVM)

Contract tests are `*.test.sol` files under `app/contracts/tests/`. `solid-vm-cli` runs them, and `make` installs it. Run a test from its own directory:

```bash
cd app/contracts/tests/Lending
solid-vm-cli test <File>.test.sol
```

`app/contracts/tests/test.sh <File>.test.sol` runs the same command and prints pass/fail counts. Deployment scripts are documented in `app/contracts/deploy/README.md`.

### App images on a running node

```bash
make app
strato-patch-app mynode app-backend:<tag> app-ui:<tag>
```

Use the exact tags that `make app` prints.

- **Node stopped:** the new images take effect on the next `strato-up`.
- **Node running:** recreate only the app containers from the node directory. Use the same environment variables you started the node with:

```bash
cd mynode
<ENV VARS> docker compose -p strato up -d --no-deps app-backend app-ui
```

### App backend and UI outside Docker

This loop runs the backend and UI with hot reload, behind the standalone app nginx. It follows `app/README.md`.

**Backend** (port 3001):

```bash
cd app/backend
npm i
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=<client-id> \
  OAUTH_CLIENT_SECRET=<client-secret> \
  NODE_URL=<node URL> \
  BASE_URL=http://localhost \
  postgres_host=<postgres host> \
  postgres_password=<postgres password> \
  npm run dev
```

The backend exits at startup in these cases:

- `OAUTH_DISCOVERY_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` or `NODE_URL` is missing.
- `postgres_password` is missing. The backend opens a read-only connection to the node's `cirrus` Postgres database. It uses `postgres_host` (default `postgres`), `postgres_port` (default `5432`) and `postgres_user` (default `postgres`).

On a local node, Postgres listens on `127.0.0.1:5432` and the password is in `mynode/secrets/postgres_password`.

**UI** (port 8080; the Vite dev server proxies `/api` to `localhost:3001`):

```bash
cd app/ui
npm i
npm run dev
```

**nginx** (port 80). Login only works through nginx. The Vite server on 8080 does not handle authentication.

```bash
cd app/nginx
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration \
  OAUTH_CLIENT_ID=<client-id> \
  OAUTH_CLIENT_SECRET=<client-secret> \
  NODE_URL=<node URL> \
  docker compose -f docker-compose.nginx-standalone.yml up -d --build
```

Open [http://localhost](http://localhost).

- `NODE_URL` must match the backend's `NODE_URL`, because nginx proxies `/rpc` to `NODE_URL/rpc`.
- Port 80 must be free. Check with `lsof -i :80`.
- `npm i` in either package also builds `app/packages/shared-types` through a `postinstall` hook.

---

## Troubleshooting

**`permission denied while trying to connect to the Docker daemon socket`**

Your user is not in the `docker` group, or the current shell hasn't picked the group up yet:

```bash
sudo usermod -aG docker $USER
newgrp docker     # or log out and back in
docker ps
```

Don't work around this with `sudo make` or `sudo strato-up`.

**`strato-up: command not found`**

`~/.local/bin` is not on your `PATH`. Run `source ~/.profile`, or open a new terminal.

**`OAuth credentials not found at ~/.secrets/strato_credentials.yaml`**

Run `strato-login`, or start the node with `--localAuth`.

**`Error: STRATO is already running in ... Run 'strato-down' first`**

A convoke process from this node directory is still alive. Run `strato-down`, then do a [clean restart](#clean-restart).

**Node behaves oddly after a restart**

Don't reuse the node directory. Follow the [clean restart](#clean-restart) sequence.

**Setup warns that RAM is not enough for from-genesis sync**

On small machines, vm-runner alone needs about 3.5 GB during genesis sync. Start the node with `--snapshot`. For sizing, see [Node requirements](../node/requirements.md).

**macOS: `ar: @....rsp: No such file or directory` while linking**

Newer Xcode command line tools changed `ar`. Run `./install_deps.sh` again. It patches the Stack-installed GHC settings and cleans stale build caches.

**Missing C library (`leveldb`, `secp256k1`, `rdkafka`, `sodium`, `pq`)**

Run `./install_deps.sh` again, or install the libraries listed in [Install Dependencies](#2-install-dependencies).

**`http://localhost` doesn't load with the standalone app nginx**

- Disable any VPN, which can break Docker networking.
- Try a private browser window, since a cached 301 redirect to https can interfere.
- On Linux, if `host.docker.internal` doesn't resolve, pass `HOST_IP=172.17.0.1`.

---

## Next Steps

1. Read the [Architecture](architecture.md) guide.
2. Read the [Contributing Guidelines](contributing.md) before opening a pull request.

---

## Need Help?

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)
