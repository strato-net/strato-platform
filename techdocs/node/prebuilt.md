# Run from Prebuilt Images

CI publishes the images of every commit it builds (develop, feature branches, pull requests and release tags) to `ghcr.io/strato-net`, so a node can run without building anything. `strato-up` works as in [Install](install.md), with two flags: `--dockerMode=all` runs the node processes in a `strato` container next to the usual service containers, and `--prebuilt` pulls the published images of the checked-out commit instead of using a local build.

## Requirements

- A Linux host that meets the [hardware requirements](requirements.md#hardware), with Docker Engine and the Compose plugin, `git`, `python3` and `curl`. Run everything as a regular user in the `docker` group, never as root.
- The [ports](requirements.md#network): 30303 TCP and UDP, 443 with `--sslDir`, otherwise `--httpPort` (default 8081).
- A host name that follows the [host name rules](configuration.md#host-name): without `--sslDir` a single label such as `stratonode`, with `--sslDir` the DNS name of the certificate.

## 1. Check out the commit to run

```bash
git clone https://github.com/strato-net/strato-platform
cd strato-platform
git checkout 19.5        # a release tag, or any commit CI has built (develop, a branch)
```

The checkout provides the scripts in `bin/` and names the images to run: `strato-up` looks for `strato:<VERSION>-<commit>` (the `VERSION` file plus the short commit, as CI tags every build) and, for a checkout without git history, `strato:<VERSION>`, which release tag builds also publish. `--prebuilt=<tag>` names an image explicitly, for example `--prebuilt=19.5` or a build of another commit. `make` and `install_deps.sh` are not needed. Images appear a few minutes after a commit is pushed, once its CI build has run.

## 2. Start the node

=== "Mainnet (upquark)"

    ```bash
    ./bin/strato-up mynode --localAuth --sslDir=/path/to/ssl --dockerMode=all --prebuilt
    ```

=== "Testnet (helium)"

    ```bash
    ./bin/strato-up mynode --network=helium --localAuth --sslDir=/path/to/ssl --dockerMode=all --prebuilt
    ```

Every other flag works as on a built node, including `--snapshot` and `--role` (a validator needs Keycloak credentials instead of `--localAuth`, see [Validator mode](configuration.md#validator-mode)).

What `strato-up` does with the two flags:

1. **Image.** It pulls the `ghcr.io/strato-net/strato` image of the checked-out commit and runs `strato-setup` from it, as your user and with the host's name, over the new node directory. The generated `docker-compose.yml` references the matching images of that build and a `strato` service that runs `convoke` over the node directory.
2. **Start.** It runs `docker compose up -d --wait`. Postgres, Redis and the identity provider become healthy first, then the `strato` container starts the node processes, then nginx and the rest.
3. **First admin.** With `--localAuth` it creates the admin user and the node's identity through `strato-user-add`, as on a built node: it prompts for a password and a recovery phrase, or runs unattended with `LOCAL_AUTH_ADMIN_PASSWORD` set and no terminal (the phrase is then written to `secrets/admin_recovery_phrase`).

!!! note "The two flags are independent"
    `--dockerMode=all` with locally built binaries runs the processes from the local `strato` image; `--prebuilt` without it keeps the processes on local binaries and pulls only the service images, which needs binaries built by `make` from the same commit so the image tags match.

## 3. Verify and operate

The usual commands work from the checkout; the node directory is recognised as a `--dockerMode=all` node by its `docker-compose.yml`, so restarts need no flags.

```bash
./bin/strato-ps mynode
curl -s https://<host>/strato-api/eth/v1.2/metadata
curl -s https://<host>/health
./bin/strato-user-add mynode alice
./bin/strato-down mynode
./bin/strato-up mynode
```

- **Logs.** The node processes and the containers write to `mynode/logs/`, as with a built node (see [Logs](operations.md#logs)). `convoke`'s own output is the `strato` container's log: `docker compose -p strato logs -f strato`.
- **Stop and start.** `strato-down` runs `docker compose down`; `strato-up` on the existing directory runs `docker compose up -d --wait`. Data is kept.
- **Upgrade.** Check out the new release tag or commit and do a [clean restart](operations.md#clean-restart) with the same flags. With `--localAuth`, keep the recovery phrases: the keys live in the node directory.
