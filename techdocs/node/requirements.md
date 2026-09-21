# Node Requirements

Check these before you [install a node](install.md).

## Hardware

| Resource | Recommended |
|---|---|
| CPU | 4 vCPU |
| Memory | 16 GB RAM |
| Disk | 100 GB or more, SSD |
| Example instance | AWS `m6a.xlarge` |

- **Validators need at least 8 GB of RAM.** Smaller machines are not supported for validators.
- **At 4 GB of RAM or less, don't sync from genesis.** `strato-setup` prints a warning, because `vm-runner` alone holds about 3.5 GB during a from-genesis sync. Start the node from a snapshot instead. Snapshots are the recommended way to start any node.
- **Runtime flags are sized once, at setup.** When the node directory is created, `strato-setup` sizes the GHC runtime flags of `strato-sequencer` and `vm-runner` to the cores and RAM it detects. Container limits win over host totals. The result is saved in `logs/rts-sizing.log` inside the node directory. If you move a node to a machine of a different size, create a new node directory.
- **Snapshot restores need extra disk in the directory you run `strato-up` from.** The downloaded archive is kept in `.snapshot-downloads/`, and it is extracted in `.snapshot-work/` before being moved into the node.

## Operating system

`install_deps.sh` supports these platforms:

| Platform | Versions |
|---|---|
| Ubuntu | 24.04 LTS, 26.04 LTS |
| Amazon Linux | 2023 |
| Oracle Linux | 8.10 |
| macOS | 15 (Sequoia), 26 (Tahoe) |

The script exits on any other platform. There you can install the dependencies by hand, following "Option B" in the repository `README.md`: Stack, Docker with the Compose plugin, and the listed libraries.

## Software

`install_deps.sh` installs:

- git
- Docker Engine with the Compose plugin
- Haskell Stack
- the build libraries: LevelDB, libsecp256k1, libsodium, libpq / PostgreSQL client, liblzma, librdkafka
- `logrotate`

The node scripts also need:

- `python3` and `curl` (or `wget`), used by `strato-snapshot` and `strato-user-add`
- `lsof`, only if you create your own snapshots

!!! warning "Run as a regular user, not root"
    Run the build and every `strato-*` command as a regular user, never as root or with `sudo`. Your user must be in the `docker` group. `install_deps.sh` adds it on Linux; then run `newgrp docker` (or log in again) and check with `docker ps`.

## Network

Open these inbound ports:

| Port | Purpose |
|---|---|
| 443/tcp | HTTPS: the app, the APIs, the STRATO Management Dashboard and `/rpc` |
| 30303/tcp | Peer-to-peer block and transaction sync (`strato-p2p`) |
| 30303/udp | Peer discovery (`ethereum-discover`) |
| 22/tcp | SSH for administration. Restrict it to your own addresses. |

HTTPS on 443 is served only when the node has a certificate (`--sslDir`). Without one, nginx serves plain HTTP on `--httpPort` (default `8081`). With a certificate, requests to the HTTP port are redirected to HTTPS.

Outbound, the node must reach:

- the network's bootnodes and peers on port 30303 (TCP and UDP)
- the OIDC provider (by default `keycloak.blockapps.net`)
- the Vault (by default `vault.blockapps.net:8093`)
- GitHub, Docker Hub and the public snapshot bucket on S3, for installs and snapshot restores

!!! warning "Keep internal ports closed"
    Only nginx should face the internet. The internal services bind as follows:

    - **Postgres (5432) and Redis (6379):** published on `127.0.0.1` only.
    - **Core API, `strato-api` (3000):** binds to the Docker bridge address on Linux (`172.17.0.1`).
    - **JSON-RPC, `ethereum-jsonrpc` (8545):** listens on all host interfaces. **Do not open 8545 in your firewall.** Public JSON-RPC traffic belongs on nginx's `/rpc` route, which applies the `strato_*` method guard.

## Identity provider credentials

Pick one of these:

- **BlockApps Keycloak (default).**
    1. Request OAuth client credentials at [support.blockapps.net](https://support.blockapps.net).
    2. Store them with `strato-login` (see [Install](install.md#4-store-your-oauth-credentials)).
- **Local auth.** Start the node with `--localAuth`. It bundles its own identity provider, so no external credentials are needed. See [Configuration](configuration.md#local-auth-mode).

## TLS certificate

For HTTPS, you need a certificate and key for the node's DNS name:

- **Files:** `server.pem` (certificate) and `server.key` (private key).
- **Location:** directly inside one directory, with no subdirectories.
- **Permissions:** readable by all users (`chmod 444 server.*`).

Pass the directory with `--sslDir=/path/to/ssl`. `strato-setup` checks that both files exist and copies them into the node's `secrets/ssl/` directory.

## DNS name

- **DNS record:** create a record that points the node's DNS name at the host's public IP.
- **Host name:** set the machine's host name to that DNS name before you create the node. `strato-setup` uses the output of `hostname` for these settings:
    - the node URL (`urlConfig.nodeUrl` in `ethconf.yaml`)
    - the auth cookie domain (`urlConfig.cookieRealm`)
    - with `--localAuth`, the local OIDC discovery URL

Check that `hostname` prints the DNS name first.
