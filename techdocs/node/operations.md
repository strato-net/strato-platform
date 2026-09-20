# Node Operations

Day-to-day tasks for a node started with `strato-up`.

`strato-ps` and `strato-down` take the node directory as an optional argument. Without one, they use the directory most recently created by `strato-setup`, which is recorded in `~/.strato/default-node`.

## Status

```bash
strato-ps mynode
```

`strato-ps` shows the following:

- **Network.** The network the node is on.
- **Sync progress.** Indexed block against the highest block peers report.
- **Block position of each layer:**

| Layer | Process | Meaning |
|---|---|---|
| `sequencer` | `strato-sequencer` | Last committed block |
| `vm` | `vm-runner` | Last executed block |
| `indexed` | `strato-indexer` | Last block written to Postgres and Redis |
| `cirrus` | `slipstream` | Last block indexed into Cirrus |
| `world` | Peers | Highest block reported by peers |

- **Containers and processes.** The Docker containers and the processes supervised by `convoke`.

`strato-ps` reads sync data from `strato-barometer syncstats`, which you can also run yourself from the node directory.

For monitoring, poll `https://<host>/health`. It returns:

- `healthStatus`: `HEALTHY`, `SYNCING`, `UNHEALTHY` or `SYNC STALLED`
- `healthIssues`: an explanation when the node is not healthy
- `lastBlock`
- `nodeAddress`
- `pbftData`

!!! note
    The PBFT round number (`pbftData.round_number`) persists across blocks and only advances when a proposal times out. A high round number does not indicate a problem by itself.

## Logs

All logs are plain files in `mynode/logs/`. The containers use Docker's `none` logging driver, so `docker logs` shows nothing.

| File | Source |
|---|---|
| `convoke.log` | The supervisor. Records start-up, process launches with their full command lines, and shutdowns. |
| `strato-sequencer`, `vm-runner`, `strato-p2p`, `ethereum-discover`, `strato-indexer`, `slipstream`, `strato-api`, `ethereum-jsonrpc`, `strato-network-monitor`, `strato-logrotate` | One file per node process, named after the executable, with no extension |
| `nginx.log`, `app-backend.log`, `app-ui.log`, `smd.log`, `apex.log`, `postgres.log`, `postgrest.log`, `redis.log`, `prometheus.log`, `docs.log` | One file per container; with `--localAuth`, also `local-auth.log` |
| `rts-sizing.log` | Runtime flag sizing chosen at setup |

### Rotation

The `strato-logrotate` process rotates every regular file in `logs/` every 10 minutes, using this policy:

- **When:** daily, or as soon as a file exceeds 100 MB.
- **Skipped:** files under 10 MB are left alone at the daily rotation.
- **Rotated files:** compressed into `logs/rotated/` with a date and time suffix.
- **Retention:** rotated files are deleted after 7 days.

The thresholds are set by the `STRATO_LOGROTATE_*` environment variables (see [Configuration](configuration.md#environment-variables)). Rotation needs the `logrotate` binary. Without it, `strato-logrotate.log` warns that rotation is disabled.

## Stop and start

Stop the node:

```bash
strato-down mynode
```

`strato-down` stops `convoke`, and `convoke` shuts the node down in two steps:

1. It sends SIGTERM to each node process group, then SIGKILL to any process still running after 5 seconds.
2. It runs `docker compose down`.

Data in the node directory is kept.

!!! note "macOS"
    `strato-down` waits for `convoke` to exit using GNU `tail --pid`, which macOS doesn't have. On macOS, run `strato-ps` to confirm nothing is still running before you touch the node directory.

To start the same node again with the same build:

```bash
strato-up mynode
```

On an existing directory, `strato-up` does two things:

- **It skips setup.** All flags are ignored, and so is `--snapshot`.
- **It starts `convoke` again.** It refuses to start if `convoke` is still running.

`convoke` treats the node as one unit. If any node process exits, `convoke` stops every process and container. It then writes the process name, its exit code and the last 20 lines of that process's log to `convoke.log`.

## Clean restart

Restart on a fresh node directory, not on top of the existing one. This applies after a crash or a stall, after changing flags, and after building a new release. The only in-place restart the repository documents is starting the same build again, for example after `strato-patch-app`.

```bash
strato-snapshot pull mynode  # optional: download the snapshot while the node still runs
strato-down mynode
mv mynode mynode.old        # or: rm -rf mynode
strato-up mynode --network=<network> --sslDir=/path/to/ssl --snapshot
```

- **Downtime.** `strato-snapshot pull` fetches the latest snapshot into the download cache ahead of time, so `strato-up --snapshot` restores from the cached archive instead of downloading it while the node is down. Run both from the same directory.
- **Keys.** With the default external auth, the node key and user keys live in the Vault, so a clean restart doesn't lose them.
- **Local auth.** With `--localAuth`, the keys are in the node directory, and moving or deleting it removes them. Restore them by choosing "Restore from an existing recovery phrase" when `strato-up` sets up the admin.

## Upgrade to a new release

A node directory is tied to the build that created it, for two reasons:

- **`strato-setup` never regenerates an existing directory.** Its `docker-compose.yml` pins the image tags of the build that created it.
- **Snapshot formats change.** In 19.1, embedded JLog replaced Kafka as the default streaming backend, and snapshots moved to the `v2/` prefix. `v2` snapshots only restore JLog state, and older snapshots are from the Kafka era.

To upgrade, build the new release and do a clean restart from a snapshot:

```bash
cd strato-platform
git fetch --tags
git checkout <release-tag>        # for example 19.1
make
strato-snapshot pull mynode  # optional: download the snapshot while the node still runs
strato-down mynode
mv mynode mynode.old
strato-up mynode --network=<network> --sslDir=/path/to/ssl --snapshot
```

Pass the same flags you used before. Validators should coordinate upgrades with the other network operators. Releases that change consensus rules activate them at agreed block heights (see [Networks](../platform/networks.md#fork-heights)).

## Snapshots

A snapshot is a cold copy of a synced node's public chain data.

| Included | Excluded |
|---|---|
| `.ethereumH/` state, except `ethconf.yaml` | `ethconf.yaml` |
| Postgres `eth` and `cirrus` databases, as dumps | Postgres `oauth` database (node and user keys) |
| `redis/` | `secrets/` |
| `jlog/` | `logs/` |

Restoring keeps the target node's own configuration, credentials and keys.

Published snapshots live at `s3://strato-snapshots/<network>/v2/`:

- **Download.** Archives are fetched over public HTTPS with `curl` or `wget`. No AWS credentials are needed.
- **Verification.** Each archive is checked against its `.sha256` file before use.
- **Cache.** A downloaded archive is kept in `./.snapshot-downloads/` and reused while its checksum still matches. The checksum is computed during the download and recorded next to the archive, so an unchanged cached archive is not re-read. `strato-snapshot pull` fills this cache ahead of a restart. After a download, older archives of the same network in the cache are deleted automatically. Archives of other networks stay, and you can delete the directory at any time to reclaim space.

Common tasks:

```bash
# Start a new node from the latest snapshot (recommended)
strato-up mynode --network=helium --snapshot

# Start from a specific snapshot
strato-up mynode --network=helium --snapshot=20260601-13:05:00Z

# Download the latest snapshot for mynode's network while the node still runs,
# so a later strato-up --snapshot or restore from this directory skips the download
strato-snapshot pull mynode

# Show what a published snapshot contains
strato-snapshot inspect --snapshot --network helium

# Restore into a stopped node without starting it (replaces existing state)
strato-snapshot restore mynode --snapshot --network helium --force
```

To create a snapshot of your own node:

```bash
strato-snapshot create mynode --network helium --output /path/helium-snapshot.tar.zst
```

The node must be synced, and `create` behaves as follows:

- **It stops the node.** It must be cold-copied, so start it again afterwards with `strato-up mynode`.
- **It runs a smoke test.** By default it restores the archive into a temporary node and starts it.

!!! warning
    Snapshots exist to speed up node start-up. They are not backups and not a disaster-recovery mechanism.

## Patch the app images

`strato-patch-app` swaps the `app-backend` and `app-ui` images of an existing node. It is meant for development and testing.

```bash
make app                                                  # prints the new image tags
strato-patch-app mynode app-backend:<tag> app-ui:<tag>
```

The script rewrites the image tags in `mynode/docker-compose.yml`. What happens next depends on whether the node is running:

- **Stopped:** the new images are used on the next `strato-up`.
- **Running:** from the node directory, recreate only the app containers. Pass the same environment variables you used to start the node:

```bash
cd mynode
<same env vars> docker compose -p strato up -d --no-deps app-backend app-ui
```

Alternatively, restart the whole node with `strato-down mynode` and `strato-up mynode`.

## Add users (local auth)

On a `--localAuth` node, add a user while the node is running:

```bash
strato-user-add mynode alice
```

The script then does the following:

1. It creates a login with a password of at least 8 characters.
2. It asks you to generate or restore a BIP-39 recovery phrase.
3. It derives a key from the phrase at path `m/44'/60'/0'/0/0`.
4. It imports the key into the node-local Vault.

The phrase is not saved anywhere, so record it. Usernames may contain letters, numbers, `.`, `_`, `@` and `-`.

`strato-up` runs the same script for the first admin with `--with-nodekey`, which also makes that key the node's operator identity.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `OAuth credentials not found at ~/.secrets/strato_credentials.yaml. Run 'strato-login' first.` | Run `strato-login`, or start with `--localAuth`. |
| `SSL certificate not found: .../server.pem` or `SSL key not found` | `--sslDir` must contain `server.pem` and `server.key` directly. |
| `Warning: Node already exists at ... Flags are ignored.` | The directory exists, so flags have no effect. Do a [clean restart](#clean-restart) to apply new flags. |
| `Note: the --snapshot flag is ignored because node directory ... already exists` | Snapshots are only restored into a new node directory. |
| `Error: STRATO is already running in ...` | Stop the node with `strato-down` first. |
| Setup repeats `vault password is not set. I'll keep trying until it is set` or `unexpected error thrown by vault` | Setup is waiting for the Vault to return the node key. Check that `--vaultUrl` is reachable and that your OAuth client credentials are valid. |
| Setup warns `... MB RAM is not enough for from-genesis sync` | Start the node with `--snapshot`. |
| The node stops by itself | Look near the end of `logs/convoke.log` for `ERROR: Process <name> ... exited with`. The lines after it are the tail of that process's log. |
| `ERROR: docker compose up failed` in `convoke.log` | A container didn't become healthy. Check its log in `logs/`. If nginx exits at start-up, `logs/nginx.log` reports an unreachable OAuth discovery URL or missing client credentials. |
| `WARNING: 'logrotate' not found on PATH` | Install `logrotate` (re-run `install_deps.sh`) and restart the node. |
| `payload has no jlog/ streaming state` during restore | The archive is an older Kafka-era snapshot. Use `--snapshot`, which resolves the current `v2` snapshots. |
| `target node is running; stop it before restore` | Run `strato-down` before `strato-snapshot restore`. |
| `strato-up: command not found` | `~/.local/bin` is not on your `PATH`. Run `source ~/.profile` or open a new terminal. |
| `permission denied` talking to the Docker socket | Add your user to the `docker` group, then run `newgrp docker`. |
