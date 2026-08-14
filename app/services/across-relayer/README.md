# Across relayer adapter for STRATO SolidVM

This directory pins the small adapter needed to run the official Across relayer against a private SolidVM EVM-ABI chain. It does not fork Across protocol logic: it supplies chain metadata, the SpokePool deployment, activation block, Universal Spoke finalizer selection, and legacy transaction mode that are normally read from public Across constants.

## Pinned upstream

- Relayer: `across-protocol/relayer@4f19338d78949cd237bbaa65fcefd9aef81edb6b`
- Contract compatibility target: `across-protocol/contracts@v4.1.28` (`dd9c9beb3f31bd1a282f851453978efaf33c848c`)
- Node.js: `>=22.18.0`

Clone the pinned relayer and apply the checked patch:

```bash
git clone https://github.com/across-protocol/relayer.git
git -C relayer checkout 4f19338d78949cd237bbaa65fcefd9aef81edb6b
./app/services/across-relayer/apply-patches.sh ./relayer
cd relayer
corepack yarn install --frozen-lockfile
corepack yarn build
corepack yarn test test/CustomChainUtils.ts test/ProofApiAuth.ts
```

## Required STRATO configuration

Substitute the deployed Universal Spoke address and deployment block:

```bash
export STRATO_CHAIN_ID=229025714941789
export ACROSS_CUSTOM_CHAINS='{"229025714941789":{"name":"STRATO","nativeTokenSymbol":"USDST","family":"evm","spokePoolAddress":"0x...","spokePoolDeploymentBlock":7,"universalSpoke":true}}'
export LEGACY_TRANSACTION_CHAIN_IDS='[229025714941789]'
export SPOKE_POOL_CHAINS_OVERRIDE='[229025714941789]'
export MULTICALL_CHUNK_SIZE_CHAIN_229025714941789=1
export MAX_FEE_PER_GAS_OVERRIDE_229025714941789=0
export MAX_PRIORITY_FEE_PER_GAS_OVERRIDE_229025714941789=0
export RPC_PROVIDERS_229025714941789='["https://strato-rpc.example"]'
export HELIOS_PROOF_API_HEADERS_FILE=/run/secrets/helios-proof-api-headers.json
```

`MULTICALL_CHUNK_SIZE...=1` is required until the SolidVM Spoke exposes Across's optional `tryMulticall`. Zero gas-price overrides are deliberate: STRATO charges its flat transaction fee in USDST, while signed transactions remain legacy type 0 Ethereum envelopes.

The normal relayer configuration still needs Ethereum `NODE_URL_1` or `RPC_PROVIDERS_1`, the relayer key, Redis, route/token inventory configuration, and `HELIOS_PROOF_API_URL` for the SP1 Helios proving service. A hosted Ethereum RPC is enough; the relayer does not require a local Ethereum full node. The proof API must expose the upstream `/v1/api/proofs` request/poll interface and return `proof` plus canonical ABI-encoded `public_values`.

Before starting the daemon or unpausing the Spoke, save one successful raw proof response and run `strato-across-deploy verify-proof` with the distinct state-updater credential. That command verifies checkpoint linkage and the configured SP1 route before broadcast, then audits the resulting Helios state and emits a proof receipt without embedding the proof or credentials.

If the prover is authenticated, place its headers in the file named by `HELIOS_PROOF_API_HEADERS_FILE`, for example `{"Authorization":"Bearer ..."}`. The patch rejects symlinks, group/other permissions, and CR/LF header injection; it reloads the JSON for secret rotation and sends the headers on both GET and POST requests. Do not put prover credentials in `ACROSS_CUSTOM_CHAINS`, environment values, or command-line arguments.

The verifier must follow the proof service, not just the Across contracts tag. As of 2026-08-13, a successful live Across Helios update on Tempo used the SP1 v6.1 Groth16 selector `0x4388a21c`, recursion vkey root `0x002f850e...f25352`, and a 356-byte proof envelope. The local verifier test replays that exact public transaction. Fail closed if a configured proof service returns another selector or recursion root until its generated verifier is separately ported, tested with a successful upstream proof, audited, and deployed through the documented upgrade ceremony.

The adapter only transports prover authentication. It does not trust the proof service: SP1 verification is performed by the SolidVM contract, and the activation command independently validates the expected selector, recursion root, program vkey, checkpoint link, canonical public values, and an Across HubPoolStore slot before its first proof broadcast.

For upstream onboarding, use `strato-across-deploy onboarding-pack` after a persistent deployment passes its post-state audit. The generated packet names the exact deployment, network, token, relayer/SDK, Swap API, and frontend records needed to graduate from `ACROSS_CUSTOM_CHAINS` to official support. Do not remove this private adapter until an upstream release contains equivalent SolidVM chain metadata, legacy transaction submission, activation-block lookup, Universal Spoke finalization, and proof-API behavior and that release passes the same smoke test.

The finalizer also relies on historical `eth_call` for SDK deposit lookup/deadline checks and on `StorageSlotVerified`, `HeadUpdate`, and `RelayedCallData` logs. The isolated STRATO replay returned distinct correct values for the same getter at blocks 7 and 8, so this behavior is validated in the platform implementation rather than being assumed.

## Local client smoke

The patch adds `scripts/solidvm-smoke.ts`. It uses the official `TransactionClient`, simulates and submits `approve` plus `fillRelay`, polls for asynchronously indexed logs, checks that `FilledRelay` parses through the official ABI, and verifies recipient balance movement. See [the integration runbook](../../docs/across-solidvm.md) for the exact validated receipt and remaining production gates.

For the smallest canonical testnet path, `deploy/across/sepolia_fast_fill.py`
accepts a successful Sepolia deposit transaction, decodes its actual
`FundsDeposited` log, approves exactly the output amount, submits the SolidVM
fill, and verifies balance/allowance deltas. On an isolated trusted local-auth
route, pass both `--approve-output` and `--trusted-header-only`. A successful
smoke must also prove that a second simulation is rejected as already filled.
This runner is intentionally one-shot and is not a substitute for the
inventory, retry, risk, refund, metrics, and alerting logic in the daemon.
