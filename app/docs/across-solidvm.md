# Across V4 on STRATO SolidVM

Status: canonical Sepolia-to-STRATO fast fill validated in an isolated test environment; Ethereum-rooted settlement and official production onboarding are not complete.

## What happens

1. A user deposits an input token into an Across SpokePool on the origin chain. The deposit emits `FundsDeposited` with the destination chain, token, amounts, recipient, deadlines, and optional message.
2. Permissionless relayers observe the deposit, price the route, and call `fillRelay` on the STRATO SpokePool. The relayer transfers destination liquidity directly to the user. STRATO emits the canonical `FilledRelay` event.
3. Across's Ethereum HubPool batches deposits and fills, then publishes refund and slow-fill roots. For a Universal Spoke, its HubPoolStore records the admin calldata and hash in Ethereum storage.
4. A finalizer asks a proving service for an SP1 Helios proof. The proof verifies finalized Ethereum beacon headers and sync-committee consensus, then commits an Ethereum execution state root plus the proved HubPoolStore storage slot. `SP1HeliosSolidVM.update` verifies the Groth16 proof and records the slot.
5. Anyone can call `AcrossV4UniversalSpoke.executeMessage`. It checks the proved slot, consumes the nonce once, and dispatches the root/admin call. Relayers claim Merkle-proved refunds from SpokePool liquidity. If a refund leaf includes `amountToReturn`, the SpokePool queues an exact existing `MercataBridge` withdrawal back to Across's Ethereum withdrawal recipient.

```text
user + origin SpokePool
          |
          | FundsDeposited
          v
permissionless relayer ---- destination liquidity ----> user on STRATO
          |                                               |
          | fillRelay                                     | FilledRelay
          v                                               v
      STRATO AcrossV4UniversalSpoke <---- root/admin ---- Ethereum HubPoolStore
                    ^                      proof target              |
                    |                                                |
             executeMessage                                 finalized beacon data
                    ^                                                |
                    |                                                v
             SP1HeliosSolidVM <------ Groth16 proof -------- hosted SP1 prover
```

The proof does not prove that a swap happened "at the current block." It proves finalized Ethereum consensus and selected Ethereum storage values. Across's already-published HubPoolStore value is what authorizes the destination root/admin action. Fast fills happen before this settlement proof and are an inventory/credit decision by relayers.

## What was built

- `SP1Groth16VerifierV6.sol`: SolidVM-native verifier using the existing metered BN254 `ecAdd`, `ecMul`, and `ecPairing` builtins. It ports the exact SP1 v6.1 circuit route currently used by Across's live Helios prover: selector `0x4388a21c`, recursion vkey root `0x002f850e...f25352`, five public inputs, and the 356-byte envelope. Its regression fixture is the successful Tempo mainnet `SP1Helios.update` transaction `0x29a09559909561f03991adfa16a0847a169d568364f5ee6ce797055097919123`; mutation tests reject the selector, exit code, recursion root, program vkey, public values, proof, and truncation.
- `SP1HeliosSolidVM.sol`: strict decoder and state machine for the canonical SP1 Helios `ProofOutputs`, including header continuity, one-week freshness, sync committees, execution roots, proved storage slots, and the upstream AccessControl-compatible admin/updater/vkey role surface.
- `AcrossV4SpokePool.sol`: Across v4.1.28-compatible deposit, fill, speed-up, slow-fill, root, Merkle refund, ABI, and event surface implemented in SolidVM. Its `amountToReturn` path uses an Ethereum-admin-configured `MercataBridge` route, a zero-first exact single-use allowance, exact escrow checks, and a persisted withdrawal ID; missing routes fail closed without consuming the leaf.
- `AcrossV4UniversalSpoke.sol`: Ethereum-proved admin messages with replay protection, a 24-hour stale-Helios emergency fallback, distinct emergency/admin/withdrawal roles, and an explicit selector dispatcher in place of EVM `delegatecall`. Its canonical `executeExternalCall(bytes)` is constrained to Helios role/vkey selectors instead of accepting arbitrary targets.
- Ethereum JSON-RPC compatibility required by ethers and the relayer: standard selectors/tuples/events, signed legacy transactions, simulation-based `eth_estimateGas`, receipts/logs, transaction lookup, SolidVM `eth_getCode`, `0x` hashes, address arrays, topic OR/null wildcards, and real `latest` bounds.
- `bin/strato-across-replay`: isolated one-validator bring-up/teardown harness using containerized support services and locally built host processes.
- `bin/strato-across-setup` plus `deploy/systemd`: approval-gated persistent-host setup with a unique `across-local-*` network/chain ID, operator-supplied validator, fail-before-write key/address check, loopback-only support services/API/JSON-RPC, bounded Kafka retention, and systemd supervision. The standalone JSON-RPC remains backward-compatible by default; this isolated harness explicitly sets `ETHEREUM_JSONRPC_HOST=127.0.0.1`.
- A pinned official relayer adapter and smoke script under `app/services/across-relayer`.
- `deploy/across/sepolia_fast_fill.py`: a one-shot minimal relayer that decodes
  the canonical Sepolia receipt, validates destination/token/deadline, can make
  an exact output-token approval, submits `fillRelay`, and proves the recipient
  balance and allowance deltas from JSON-RPC.

No new consensus precompile was added. BN254 was already a deterministic, metered SolidVM builtin, so this integration does not introduce a precompile fork or an inherent state-root mismatch. This branch does change SolidVM gas accounting so receipts report actual metered consumption and execution honors the signed transaction gas limit; that is consensus/runtime behavior, so every validator must run the same new SolidVM/ABI/RPC binaries before a network enables these contracts.

The persistent trial also found and fixed a pre-existing consensus-domain bug:
SolidVM's `block.chainid` returned the legacy peer `networkID`, while
`eth_chainId` and signed transactions used the configured EIP-155 `chainId`.
The builtin now uses `chainId`, and an isolated regression test pins the
mapping. The one-validator trial was safely aligned in configuration before
the fill; a multi-validator network must roll out the corrected VM binary to
every validator together.

## Reproduced evidence

The isolated chain used chain ID `229025714941789` and a genesis-funded relayer. For the current verifier route, two isolated node processes restored the same stopped chain snapshot and independently replayed the same deployment and proof transactions. The proof fixture is calldata from successful Tempo mainnet (chain ID 4217) Across Helios transaction `0x29a09559909561f03991adfa16a0847a169d568364f5ee6ce797055097919123`: Helios `0x2bc84a3777469f67e040dab9d00512a5d5258f39`, gateway `0x7DA83eC4af493081500Ecd36d1a72c23F8fc2abd`, routed v6.1 verifier `0xb69f2584CBcFf99a58C4e7002E8b89Af54a6f4e2`, and program vkey `0x0052e51b66660cd62ad4a2b38fe53f4c5a0dbfa4876a2ebc58bb1c0e4945af03`.

| Check | Result |
|---|---|
| V6.1 verifier deployment tx | `0x21b7a8ea5e289d3c4c726abc0988ab9117b50889775e4a14047ec0bdd72e1d6c` on A and B; contract `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` |
| Post-deployment state root | `0x5ac791657274a2b2535d3e36ec8cf07d5fbd2883b5797555ce57e984adc95fa6` on A and B |
| Live Across proof replay tx | `0x8bf7c6c2e758c0d114fc28b6a51bbadd36ead32be9af77acaa945bd192c9270e` on A and B, status 1, gas 124774 |
| Post-proof state root | `0x12f419da42ce36ac5ae968d3f22066d6331b16565c900e8ac3e5af130ba0de2e` on A and B |

Block hashes differed because the two independent replays had different timestamps; transaction hashes and state roots matched. That is the relevant deterministic execution check. Both disposable nodes were stopped after the replay.

The official Across `TransactionClient` then submitted a fresh local fill:

| Check | Result |
|---|---|
| Approval tx | `0x38ba7e430898ab87f51917f9398ba8ebdc1e1f98e5c252df977d548b9cc08d09`, status 1 |
| Fill tx | `0xd3d2381e03f444fe2a482d7bdd889ba6776ed83e3896654157588235075860c5`, status 1, gas 2047 |
| Deposit ID | `424243` |
| Token movement | recipient increased from 1 to 2 USDST |
| Event topic | canonical `FilledRelay` topic `0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208` |
| SDK parse | official ABI returned `FilledRelay` |
| Filter check | address, `latest`, null wildcard, OR topic, and indexed deposit ID returned the event |

The relayer fell from 98.97 to 97.95 USDST: 1 USDST destination liquidity plus two 0.01 USDST flat transaction fees (approval and fill). The reported SolidVM gas is execution accounting, while the configured economic fee remains the flat USDST charge.

### Canonical Sepolia to isolated STRATO fast fill

This is the minimal real cross-chain testnet path. The origin transaction uses
Across's canonical Sepolia SpokePool and the destination is an isolated
SolidVM network.

| Check | Result |
|---|---|
| Sepolia SpokePool | `0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662` |
| Canonical deposit | successful `FundsDeposited` receipt from the Sepolia SpokePool |
| Route | Sepolia WETH to an isolated STRATO USDST deployment |
| Amount | capped test amount with equal configured input/output base units |
| Destination | unique `across-local-*` network and EIP-155 chain ID |
| SolidVM SpokePool | standalone fast-fill SpokePool deployed from the checked-in source |
| Liquidity and approval | relayer funded and approved for the exact output amount |
| Fill | status `1`, canonical `FilledRelay`, and metered SolidVM gas |
| Post-state | recipient increased by the exact output amount; allowance returned to zero |
| Replay protection | an identical post-fill simulation fails with `Across relay already filled` |
| Runtime health | service active with zero restarts after the final audit |

Environment-specific transaction receipts, operator addresses, RPC
credentials, and host details are deliberately excluded from the repository.
The reusable runner emits a local evidence file containing the origin receipt,
destination receipt, balance delta, allowance delta, and replay result.

Historical JSON-RPC state was also validated live because the official SDK binary-searches `numberOfDeposits()` and reads `fillDeadlineBuffer()` at past blocks. On the disposable replay, `pausedDeposits()` returned `false` at block 7 and `true` at block 8 and `latest`; block 7 had state root `34b950d270f77a5bf064405763d9b90f2b53898f25649d1e1d3e51135534e2b7`, while block 8 had `5fdbc7e19cb8b596b04392fcccb51470cd84a918e396cac62f138c5b2af09364`.

## Deployment and custody ceremony

Do not deploy with one address in every role. Use these independently reviewed values:

1. Deploy the Groth16 verifier pinned to the proof service's live selector, full verifier hash, recursion vkey root, and pairing key. Before activating deposits, submit a fresh proof returned by the configured proof service and compare those pins to the signed deployment manifest. Across's v4.1.28 contracts tag does not itself pin the current proof circuit: the shared SP1 gateway can add newer verifier routes. The checked-in `strato-across-deploy` tool validates these pins and requires a chain-specific literal acknowledgment before broadcasting.
2. Deploy Helios from a current finalized Ethereum checkpoint generated by a checksum-pinned genesis binary. The deployer initially holds `DEFAULT_ADMIN_ROLE`; grant `STATE_UPDATER_ROLE` to the permissionless finalizer set and `VKEY_UPDATER_ROLE` to the Universal Spoke if Across governance will rotate the vkey through the normal cross-chain flow.
3. Deploy the Universal Spoke with: a STRATO emergency multisig owner; Ethereum `crossDomainAdmin` equal to the upstream Across HubPool; Ethereum `withdrawalRecipient` supplied by Across for this chain; quote/deadline buffers; initial deposit ID; at least a 24-hour emergency buffer; Helios; and Ethereum HubPoolStore. This port starts with deposits and fills paused, closing the interval before proof service, routes, roles, and upstream registration are ready.
4. Grant Helios `DEFAULT_ADMIN_ROLE` to the Universal Spoke, verify `hasRole` and `getRoleMember`, then renounce the deployer role. The port refuses to remove the last admin, so this handoff fails closed if step 4 is ordered incorrectly.
5. Through an Ethereum-proved HubPoolStore message, set each STRATO token return route to the audited `MercataBridge` plus its Ethereum chain/token. Keep deposits/fills paused until route, checkpoint, vkey, proof API, finalizer, and public RPC checks all pass.
6. Record source hashes, constructor arguments, addresses, deployment/activation blocks, role membership, chain ID, checkpoint, program vkey, return routes, and the emergency multisig threshold in a signed manifest.

The fail-closed command sequence is:

```bash
# Offline: validates all pins and writes private request templates. No network call.
strato-across-deploy prepare deploy/across/config.json --out ceremony

# Mutating: exact chain ID acknowledgment is mandatory.
strato-across-deploy deploy deploy/across/config.json \
  --out deployment --token-file /run/secrets/deployer.jwt --broadcast \
  --ack "DEPLOY ACROSS TO CHAIN <chain-id>"

# Mutating: use the distinct STATE_UPDATER key and raw proof API response.
strato-across-deploy verify-proof deploy/across/config.json \
  deployment/deployment-manifest.json proof-response.json \
  --out deployment/first-proof-receipt.json \
  --token-file /run/secrets/state-updater.jwt --broadcast \
  --ack "VERIFY ACROSS PROOF ON CHAIN <chain-id>"

# Read-only re-audit can be run independently at any time.
strato-across-deploy audit deploy/across/config.json \
  deployment/deployment-manifest.json

# Read-only: creates the non-secret upstream registration packet and refuses an
# unpaused or unaudited manifest, unsafe public URLs, or incomplete token routes.
strato-across-deploy onboarding-pack deploy/across/config.json \
  deployment/deployment-manifest.json deploy/across/tokens.json \
  --public-rpc-url https://rpc.your-domain.tld/rpc \
  --explorer-url https://explorer.your-domain.tld \
  --bundle /opt/strato-across/strato-across-solidvm-amd64.tar.gz \
  --out deployment/across-onboarding.json
```

`deployment-journal.json` is updated after every successful contract or role transaction, so a partial ceremony remains auditable even though the signed-style final manifest is withheld until all post-state checks pass. `verify-proof` accepts either `update_calldata` from a successful upstream proof response or the inner `{proof,public_values}` object. Before it sends anything, it checks the 356-byte envelope, selector, exit code, recursion root, canonical public-value layout, exact linkage to the deployment head/header/committee, advancing head, one-hour freshness, and at least one nonzero slot from the configured Across HubPoolStore. After inclusion it reads back the head, header, execution root, and every proved storage slot, then writes a mode-0600 receipt containing hashes rather than proof material. A proof receipt is never overwritten.

Upstream v4.1.28 already deprecated the local enabled-deposit-route storage; routability is resolved from HubPool/ConfigStore token mappings. Official chain onboarding still needs Across governance to register this chain and those mappings. `onboarding-pack` turns the audited manifest plus `tokens.example.json` inventory into the concrete handoff: chain/RPC/explorer metadata; SpokePool, SP1 Helios, verifier addresses, blocks, transaction hashes, and source hashes; token directions and canonical return bridges; proof-route and upstream pins; artifact hashes; and explicit pre-activation gates. It also lists the required changes in Across's `contracts` deployment registry, `constants` network/token maps, relayer, SDK, Swap API, and frontend metadata. The packet contains no keys, RPC credentials, or prover headers and is safe to share after its addresses and URLs are reviewed.

## Cheapest test topology

One validator is enough for functional development and the cheapest smoke environment. A second node does not have to stay running: initialize it separately and replay the same signed transactions to compare state roots. This is what the A/B validation did. Four validators are a production fault-tolerance/deployment gate, not a prerequisite for verifying the integration.

On a persistent host, install the prebuilt amd64 bundle, derive a fresh validator address with `strato-vault-import-key --printAddress`, and create a never-reused network with `strato-across-setup`. The persistent network name must use an `across-local-*` suffix; this yields a distinct EIP-155 chain ID while retaining the tested Across profile. Unlike the deterministic replay fixture, this operator-key genesis does not fund the public Foundry relayer; provision each relayer wallet explicitly through an audited custody/funding step. The exact private key is checked against the genesis validator before any key is written to the vault. Run the node under the supplied systemd unit so child processes survive the shell. The harness itself accepts:

```bash
LOCAL_AUTH_PASSWORD_FILE=/secure/password \
LOCAL_AUTH_PRIVATE_KEY_FILE=/secure/private-key \
ACROSS_VALIDATOR_ADDRESS=0x... \
strato-across-replay /srv/strato-across start

strato-across-replay /srv/strato-across stop

# Read the API health URL from the generated node configuration without start.
strato-across-replay /srv/strato-across api-url
```

Do not reuse the shared testnet: genesis, chain ID, binaries, and contract deployment are intentionally isolated.

Build the runtime bundle off-host and transfer only the binaries, native library
closure, and pinned support images. A trial host needs enough RAM and disk for
the node plus support services, bounded Kafka/database retention, and measured
headroom for proof and refund execution. Keep its APIs loopback-only unless a
separate hardened public RPC is explicitly deployed.

## Remaining gates

| Gate | State | Required outcome |
|---|---|---|
| Trial host preflight | operator responsibility | Capture a rollback point, isolate or stop unrelated workloads, verify resources, and keep administrative services private. |
| Persistent one-validator network | isolated smoke complete | Create a unique `across-local-*` network, deploy the standalone SpokePool, provision bounded relayer liquidity, and record the deposit/fill/balance/replay evidence outside the repository. |
| Actual Universal contracts | deployment ceremony exercised on disposable chain; post-state audit passed; live proof replayed in earlier deterministic fixture | On the persistent isolated chain, use a current finalized checkpoint and the fail-closed deploy/proof commands with distinct deployer and updater keys; record manifests, proof receipt, roles, and source hashes. |
| Ethereum HubPool/ConfigStore | not onboarded | Across governance/upstream must register the chain, SpokePool, tokens, routes, adapter, activation blocks, and UI/API metadata. Chain-level deployment is permissionless; official Across liquidity/routing is not automatic. |
| Hosted infrastructure | hosted Sepolia RPC used for the live deposit/fill; persistent SP1 prover not configured | Production needs reliable Ethereum RPC plus authenticated `HELIOS_PROOF_API_URL`; no full Ethereum node is required. |
| Refund bridge | implemented locally, external leg unvalidated | An Ethereum-proved admin route queues `MercataBridge.requestWithdrawal`, verifies exact escrow, records its withdrawal ID, emits canonical `TokensBridged`, and clears allowance. Configure an enabled Ethereum asset route, audit it, and complete/reconcile the real custody transaction. |
| Relayer operation | one-shot minimal relayer completed the canonical test; official daemon not live | Use `sepolia_fast_fill.py` for bounded trials. For continuous service, apply the pinned daemon patch and configure inventory, Redis, keys, risk caps, `MULTICALL_CHUNK_SIZE...=1`, hosted RPC/prover, metrics, and alerts. |
| Public RPC | loopback only | TLS, rate limits, request/body caps, bounded log ranges, redundancy, monitoring, and external ethers/viem conformance. |
| Four-validator production network | not started | Identical binary/config rollout, four independent validators, fault/restart test, peer isolation, and state-root agreement. |
| Real cross-chain value test | canonical testnet fast fill complete and reconciled | The production gate is Ethereum root publication, SP1 update, `executeMessage`, and relayer refund. Across testnet deliberately does not perform settlement, so that leg requires a capped mainnet/onboarded-chain trial. |
| Security review | not complete | Audit ABI bridge, Groth16/Helios port, proof-circuit pin/upgrade procedure, selector dispatcher, checkpoint ceremony, updater/vkey/admin roles, relayer custody, and emergency procedures. |

The result now proves a canonical Sepolia deposit can be permissionlessly
observed and fast-filled on SolidVM with exact token movement, canonical event
shape, and replay protection. It does not make STRATO discoverable in Across's
API, MetaMask, or Uniswap, and it does not prove an Ethereum HubPool root
settling the fill or returning relayer capital. Those require official route
registration plus the production Universal Spoke/Helios ceremony.
