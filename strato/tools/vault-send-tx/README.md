# vault-send-tx

Sign and send transactions on external chains using the STRATO vault signing service.

The vault is an open-source key management service that stores private keys
server-side and signs arbitrary 32-byte hashes via secp256k1. BlockApps runs
a hosted instance at `vault.blockapps.net`, but anyone can run their own — the
vault ships as part of the STRATO node stack (`docker-compose.vault.yml`).
Long-term this is intended to become a standalone, open-source embedded wallet.

This script builds a transaction locally, asks a vault instance to sign the
hash, and submits the signed tx to any EVM chain's RPC.

## How it works

```
┌──────────┐     GET /key        ┌────────────┐
│  script   │ ──────────────────▶ │   vault    │
│           │ ◀────────────────── │ (your own  │
│ build tx  │    { address }      │  or hosted)│
│ hash tx   │                     │            │
│           │  POST /signature    │            │
│           │ ──────────────────▶ │ decrypt pk │
│           │ ◀────────────────── │ sign hash  │
│           │    { r, s, v }      └────────────┘
│           │
│ assemble  │  eth_sendRawTransaction
│ signed tx │ ──────────────────▶  EVM chain RPC
└──────────┘
```

The vault never sees the transaction details — only a 32-byte keccak hash.
The private key never leaves the vault. Chain ID, nonce, gas are all handled
client-side.

## Prerequisites

1. **Node.js 18+**
2. **A vault instance** — either the hosted one or your own (`docker-compose.vault.yml`)
3. **`strato-auth`** on your PATH (installed via `stack install` from `strato/libs/strato-auth`)
4. **`~/.secrets/oauth_credentials`** with your OAuth config:
   ```
   OAUTH_DISCOVERY_URL=<discovery-url>
   OAUTH_CLIENT_ID=<client-id>
   OAUTH_CLIENT_SECRET=<client-secret>
   ```

## Setup

```bash
cd strato/tools/vault-send-tx
npm install
```

## Authenticate

```bash
strato-auth
```

Opens a device-flow login. Visit the URL, enter the code, log in. Token is
saved to `~/.secrets/stratoToken` and auto-refreshes until the refresh token
expires.

## Usage

```bash
# Dry-run: build + sign, but don't submit (safe to repeat)
node send-tx.js

# Send 0.001 ETH to an address on Sepolia (default network)
node send-tx.js --to 0x... --value 0.001 --submit

# Same thing on Base Sepolia
NETWORK_RPC=https://sepolia.base.org \
  node send-tx.js --to 0x... --value 0.001 --submit

# Arbitrum Sepolia
NETWORK_RPC=https://sepolia-rollup.arbitrum.io/rpc \
  node send-tx.js --submit

# Point at your own vault
VAULT_URL=http://localhost:8093 \
  node send-tx.js --submit
```

## Across test runner

This package also includes a minimal Across bridge PoC for moving supported
assets across supported EVM chains with the vault signer.

Default behavior:
- discovers the Across-supported chain RPCs and token addresses
- fetches an Across quote for `1 USDC`
- prints balances and quote details
- in dry-run mode, signs but does not broadcast
- with `--submit`, sends approval txs if needed, sends the bridge tx, then polls
  Across until the deposit is `filled`
- retries the temporary `DepositNotFound` indexer lag that can happen on testnet
- refreshes the quote after approvals so the bridge tx uses current allowance state

Examples:

```bash
# Dry-run the default Sepolia -> Base Sepolia USDC test
node across-bridge.js

# Broadcast the live test
ACROSS_API_KEY=... node across-bridge.js --submit

# Reverse direction
ACROSS_API_KEY=... node across-bridge.js \
  --origin-chain-id 84532 \
  --destination-chain-id 11155111 \
  --submit

# Change amount or recipient
ACROSS_API_KEY=... node across-bridge.js \
  --amount 0.5 \
  --recipient 0x... \
  --submit

# Bridge native ETH instead of USDC
ACROSS_API_KEY=... node across-bridge.js \
  --symbol ETH \
  --amount 0.001 \
  --submit

# Override token lookup with exact Across-supported token addresses
ACROSS_API_KEY=... node across-bridge.js \
  --origin-chain-id 84532 \
  --destination-chain-id 11155111 \
  --input-token 0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  --output-token 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
  --amount 0.5 \
  --submit
```

Arguments:

| Flag | Default | Description |
|------|---------|-------------|
| `--origin-chain-id` | `11155111` | Origin chain ID |
| `--destination-chain-id` | `84532` | Destination chain ID |
| `--symbol` | `USDC` | Token symbol looked up through Across |
| `--input-token` | unset | Exact origin token address to use instead of symbol lookup |
| `--output-token` | unset | Exact destination token address to use instead of symbol lookup |
| `--amount` | `1` | Human-readable token amount |
| `--recipient` | vault address | Destination recipient |
| `--submit` | off | Broadcast approval and bridge txs |

Additional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ACROSS_API_BASE` | `https://testnet.across.to/api` | Across API base URL |
| `ACROSS_API_KEY` | unset | Bearer token for Across API |
| `ORIGIN_RPC` | Across chain RPC | Override origin RPC |
| `DESTINATION_RPC` | Across chain RPC | Override destination RPC |

## Environment variables

| Variable      | Default                                        | Description                          |
|---------------|------------------------------------------------|--------------------------------------|
| `NETWORK_RPC` | `https://ethereum-sepolia-rpc.publicnode.com`  | Target chain RPC                     |
| `VAULT_URL`   | `https://vault.blockapps.net:8093`             | Vault instance (hosted or your own)  |

Chain ID is auto-detected from the RPC — no hardcoded chain assumptions.

## CLI flags

| Flag              | Description                         |
|-------------------|-------------------------------------|
| `--to 0x...`      | Recipient address (default: self)   |
| `--value 0.001`   | Amount in ETH (default: 0)          |
| `--submit`        | Actually broadcast (default: dry-run) |

## What this proves

The vault's `POST /signature` endpoint is **chain-agnostic** — it signs any
32-byte secp256k1 hash. No vault code changes were needed to go from
STRATO-only to any EVM chain. Same key, same address, any network.

This is the foundation for multi-chain vault signing.
