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
