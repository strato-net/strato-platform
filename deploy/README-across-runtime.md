# Isolated Across validator runtime

This directory is the host-side handoff for the cheapest persistent trial. It
does not authorize changing a host: stop existing workloads and install this
bundle only after the host owner explicitly approves repurposing it.

## Bundle layout

Install the prepared artifact tree under `/opt/strato-across`:

- `bin/`: Linux x86-64 STRATO executables plus `strato-across-setup`,
  `strato-across-replay`, `strato-across-deploy`, and `strato-user-add`.
- `lib/`: the exact native library closure from the Ubuntu 22.04 build image;
  the systemd unit supplies `LD_LIBRARY_PATH=/opt/strato-across/lib`.
- `share/bip39-english.txt`: word list used only by the interactive recovery
  flow; the unattended trial imports an explicitly provided key.
- `support-images-amd64.tar`: local-auth, vault proxy, PostgreSQL, Redis, and
  Kafka images, all verified as Linux/amd64 and tagged distinctly.
- `systemd/`: service unit and root-owned environment-file template.
- `contracts/`, `deploy/`, `relayer/`, and `docs/`: deployment sources,
  fail-closed ceremony tooling, pinned adapter, tests, and the integration
  runbook.
- `BUILD_METADATA`, `native-packages.tsv`, and `support-images-amd64.tsv`: the
  source identity, copied Ubuntu 22.04 library packages, and exact image IDs.
- `SHA256SUMS`: verify before installing or starting anything.

## Approval-gated install sequence

These are operator steps, not permission to execute them automatically:

1. Verify `sha256sum -c SHA256SUMS`; verify every ELF is x86-64 and every
   exported image is Linux/amd64 after `docker load`. The host prerequisites
   are Docker Engine with Compose v2, `curl`, `python3`, and `openssl`.
2. Create a dedicated `strato-across` account, add it only to the Docker group,
   and install this tree root-owned at `/opt/strato-across`. Docker-group
   membership is effectively root-equivalent, so this must remain a dedicated
   trial host with no unrelated workloads or credentials.
3. Generate a fresh secp256k1 validator key into a mode-0600 file owned by the
   service account. Never place a key in the bundle. Derive its address without
   database access; if the generated scalar is invalid, the command fails and
   the key must be regenerated:

   ```bash
   umask 077
   openssl rand -hex 32 > /etc/strato-across/validator-private-key
   chown strato-across:strato-across /etc/strato-across/validator-private-key
   strato-vault-import-key --printAddress < /etc/strato-across/validator-private-key
   ```

4. Initialize a never-before-used network name and empty node directory:

   ```bash
   strato-across-setup /srv/strato-across trial-YYYYMMDD 0xVALIDATOR_ADDRESS
   ```

   This creates a network named `across-local-trial-YYYYMMDD`; therefore its
   EIP-155 chain ID differs from the deterministic `across-local` replay chain.
   The generated genesis funds and admits only the supplied validator. The
   public Foundry validator key is never accepted implicitly, and the public
   Foundry relayer receives no balance in this operator-key profile.
5. Install `/etc/strato-across/runtime.env` as root:root mode 0600. Install its
   referenced password/key files as strato-across:strato-across mode 0600 so
   only the service can read them. The start harness requires the expected
   validator address and the key importer rejects a mismatch before any key is
   written to the local vault.
6. Review that all compose ports are `127.0.0.1` only, then install and start
   `strato-across.service`. Its foreground supervisor fails and restarts the
   unit if any required host process exits. The API readiness probe reads
   `apiListenAddress` and `apiPort` from the generated `.ethereumH/ethconf.yaml`;
   on a standard Linux Docker host that address is normally `172.17.0.1`, not
   loopback. `strato-across-replay NODE_DIR api-url` prints the exact URL being
   probed without starting anything. Do not expose the admin API, signer,
   PostgreSQL, Redis, Kafka, or JSON-RPC publicly.
7. Verify the network name, chain ID, validator address, genesis/state root,
   block progress, image IDs, process RSS, disk growth, swap, transaction fees,
   and fresh fatal/OOM logs before contract deployment.

## Fail-closed contract ceremony

Copy `deploy/across/config.example.json` outside the bundle and fill it only
from a checksum-verified SP1 Helios genesis run against a fresh finalized
Ethereum checkpoint. `prepare` validates every pinned value and emits the exact
source-map requests without making a network request:

```bash
strato-across-deploy prepare /etc/strato-across/deployment.json \
  --out /srv/strato-across/deployment
```

Deployment additionally requires `--broadcast` and the literal acknowledgment
`DEPLOY ACROSS TO CHAIN <decimal-chain-id>`. The token is read from a regular
mode-0600 file, the live JSON-RPC chain ID must match, every receipt is checked,
and the manifest is written only after read-only post-state checks pass. The
Spoke starts with both deposits and fills paused. This tool deliberately does
not configure return routes or unpause it; those actions must arrive through a
proved Ethereum HubPoolStore message after upstream registration and finalizer
validation. A private deployment journal is updated after every successful
transaction so a partial ceremony can be recovered and audited.

Before activation, submit one fresh raw prover response with the distinct
state-updater credential. This command validates route, envelope, checkpoint
continuity, freshness, storage-slot layout, and a nonzero slot from the pinned
Across HubPoolStore before broadcasting, then reads back the new head, header,
execution root, and proved slots:

```bash
strato-across-deploy verify-proof /etc/strato-across/deployment.json \
  /srv/strato-across/deployment/deployment-manifest.json proof-response.json \
  --out /srv/strato-across/deployment/first-proof-receipt.json \
  --token-file /run/secrets/state-updater.jwt --broadcast \
  --ack "VERIFY ACROSS PROOF ON CHAIN <decimal-chain-id>"
```

`relayer.generated.env` contains only non-secret adapter values. Store RPC,
wallet, Redis, and prover credentials separately. Authenticated prover headers
belong in a regular mode-0600 JSON file referenced by
`HELIOS_PROOF_API_HEADERS_FILE`; the patched relayer rejects symlinks and loose
permissions and reloads the file for rotation.

After the post-state audit, copy `deploy/across/tokens.example.json`, fill every
STRATO/Ethereum token pair and audited canonical return bridge, and emit the
non-secret upstream review packet. This is read-only and refuses a manifest
unless both deposits and fills are still paused and its post-state audit proves
the expected chain:

```bash
strato-across-deploy onboarding-pack \
  /etc/strato-across/deployment.json \
  /srv/strato-across/deployment/deployment-manifest.json \
  /etc/strato-across/tokens.json \
  --public-rpc-url https://rpc.your-domain.tld/rpc \
  --explorer-url https://explorer.your-domain.tld \
  --bundle /opt/strato-across/strato-across-solidvm-amd64.tar.gz \
  --out /srv/strato-across/deployment/across-onboarding.json
```

The packet is the Across handoff, not an activation transaction. It identifies
the exact records needed in the official contracts deployment registry,
`@across-protocol/constants` network/token maps, relayer and SDK, Swap API, and
frontend metadata. Across governance still has to approve and publish those
records and the Ethereum HubPoolStore messages before the Spoke can be
unpaused or appear in wallet and router UIs.

A minimal persistent fast-fill deployment was validated in an isolated test
environment: a canonical Sepolia deposit was filled by the standalone SolidVM
SpokePool, with exact recipient/allowance deltas and replay rejection.
`across/sepolia_fast_fill.py` is the reusable one-shot runner; environment-
specific receipts and operator details are intentionally not checked in.

Production settlement still needs a fresh finalized Ethereum checkpoint,
authenticated SP1 proof API, Universal Spoke role ceremony, upstream Across
registration, and a capped refund-cycle approval. Across testnet does not run
relayer settlement, so it cannot validate that last leg. Neither the hosted RPC
nor prover is a consensus trust assumption: Helios/SP1 verification and the
pinned proof-route checks reject invalid data on STRATO.
