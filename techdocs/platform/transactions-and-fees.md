# Transactions & Fees

This page covers:

- the transaction types STRATO accepts
- the three ways to sign a transaction
- nonces and limits
- how fees are charged
- simulating a transaction and following it to a result

All contracts run on SolidVM. There is no EVM execution engine.

## Transaction Types

| Type | What it carries | Typical source |
|------|-----------------|----------------|
| **Function call** (`MessageTX`) | `to`, `funcName`, string `args`, `nonce`, `gasLimit`, `network`, optional `attribution` | Bloc API, the STRATO app, STRATO wallet |
| **Contract creation** (`ContractCreationTX`) | SolidVM source `code`, `contractName`, `args` | Bloc API (`CONTRACT` payload) |
| **Ethereum transaction** (`EthereumTX`) | Standard Ethereum fields: `nonce`, `gasPrice`, `gasLimit`, `to`, `value`, `data` | `eth_sendRawTransaction` from EVM tooling |

### Signature formats

- **STRATO legacy.** An RLP-encoded function call or contract creation, signed over its hash, with `v` = 27/28.
- **EIP-712 (typed).** A function call signed as EIP-712 typed data and sent in an EIP-2718-style envelope (`type byte || RLP`). In JSON it has `txVersion` ≥ 1. Wallets such as MetaMask use this.
    - Domain: `{ name: "STRATO", version: "1" }`
    - Type: `Transaction(address to,string funcName,string[] args,uint256 nonce,uint256 gasLimit,string network)`
    - If the transaction has an attribution, the type gets a trailing `bytes attribution` field.
- **Ethereum legacy.** A 9-field RLP transaction with an EIP-155 `v` (chain ID included) or a pre-EIP-155 `v` of 27/28. Use the chain IDs in [JSON-RPC](../reference/json-rpc.md#chain-ids).

### How Ethereum transactions run

- **Value transfer with empty `data`:** becomes a transfer of the native token, USDST.
- **Call with `data`:** the 4-byte selector is matched to a SolidVM function on the target contract, and the arguments are ABI-decoded.
- **Contract creation with EVM bytecode:** rejected.
- **EIP-1559 and EIP-2930 typed Ethereum transactions:** not decoded. Sign legacy transactions.

## Signing Paths

| Path | Who signs | How |
|------|-----------|-----|
| **1. Server-side (Vault)** | The Vault, with the user's custodial key | `POST /bloc/v2.2/transaction` with a bearer token |
| **2. Client-signed** | Your code, with your own key | Build the transaction, sign it, then submit to `POST /strato-api/eth/v1.2/transaction` (JSON) or `eth_sendRawTransaction` (RLP) |
| **3. External wallet in the app** | MetaMask or the STRATO wallet extension | The app builds the unsigned transaction, the wallet signs it with EIP-712, and the signed transaction is submitted |

### 1. Server-side signing

Send the [Bloc transaction body](../reference/strato-node-api.md#transaction-request-body) with an OAuth token. The node looks up your key in the Vault, fills in nonces, signs and submits. The [App API](../reference/api.md) write endpoints also use this path.

```bash
curl -s -X POST "https://app.testnet.strato.nexus/bloc/v2.2/transaction?resolve" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"txs":[{"type":"FUNCTION","payload":{"contractAddress":"<address>","method":"set","args":{"_x":5}}}]}'
```

### 2. Client-signed

1. `POST /bloc/v2.2/transaction/unsigned` with your `address` and the transactions. No token is needed. Each result has `data`: `nonce`, `gasLimit`, `to`, `functionName`, `args`, `network`.
2. Sign the EIP-712 typed data above with `network` set to the value you submit. The STRATO wallet and app use `"STRATO"`.
3. `POST /strato-api/eth/v1.2/transaction`:

    ```json
    { "nonce": 12, "gasLimit": 32100000000, "to": "<address>", "funcName": "set", "args": ["5"],
      "network": "STRATO", "r": "<64 hex>", "s": "<64 hex>", "v": "1b", "txVersion": 1 }
    ```

4. Poll for the result (see [Transaction results](#transaction-results)).

With EVM tooling, sign a legacy Ethereum transaction and send it with [`eth_sendRawTransaction`](../reference/json-rpc.md#writes).

### 3. External wallet in the app

When you connect MetaMask or the STRATO wallet extension to the app, the backend builds unsigned transactions and the wallet signs them with EIP-712.

These calls are routed through your on-chain **User wallet contract**. The Bloc `?username=` option wraps each contract call as `User.callContract(...)`, or `User.createContract(...)` for deployments. The contract being called sees your User wallet as `msg.sender`.

Signing in with Ethereum (SIWE) is not supported. See [Identity & Vault](identity-and-vault.md).

## Nonces

- A transaction runs only when its `nonce` equals the sender's current nonce. The node rejects transactions whose nonce is lower than that.
- To read the current nonce:
    - `GET /strato-api/eth/v1.2/account?address=<address>` (the `nonce` field)
    - `eth_getTransactionCount`
- If you leave out `txParams.nonce`, Bloc assigns sequential nonces within a request. For many concurrent requests from one account, use `POST /bloc/v2.2/transaction/parallel`, which keeps a 10-second per-address nonce cache.
- When you sign yourself and send several transactions, give each one the next nonce in sequence.

## Limits

These are set per node when it starts (see [Node configuration](../node/configuration.md)):

| Flag | Default | Effect |
|------|---------|--------|
| `--txSizeLimit` | `2097152` bytes (2 MiB) | Larger transactions are rejected at submission, in the pool, and at execution |
| `--gasLimit` | `1000000` | The VM's gas cap. The pool also rejects a transaction whose intrinsic gas reaches this value. |
| `--maxTxsPerBlock` | `500` | Maximum transactions per block |

nginx also limits request bodies to 4 MB (1 MB for `/api`).

Gas is not priced: `eth_gasPrice` returns `0x0` and there is no gas fee to tune. The only per-transaction cost is the fee below.

## Fees

Every transaction pays a flat fee **before it runs**:

- **one voucher**, if the sender holds one, otherwise
- **0.01 USDST**.

### How the fee is charged

1. For each transaction, `vm-runner` calls `decide()` on the **Decider** contract at `0xDEC1DE`.
2. Decider asks **DeciderState** (`0xDEC1DE02`) for the current fee contract, then `delegatecall`s that contract's `payFees()` as the sender.
3. The genesis `payFees()` tries to burn 1 voucher (the voucher token at `0x100e`). If that fails, it transfers 0.01 USDST (`0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010`) to the FeeCollector (`0x100d`).
4. If the fee can't be paid, the transaction is rejected for insufficient funds and does not run.
5. Once the fee is paid, it is kept **even if the transaction reverts**.

### Fee contract per network

DeciderState's owner can install a different fee contract with `updatePayFeeContract`:

| Network | Active fee contract |
|---------|---------------------|
| Mainnet (upquark) | DeciderState's own `payFees` (voucher or 0.01 USDST to FeeCollector) |
| Testnet (helium) | A separately installed contract, `HeliumFeeRouterV2` |

The `FeeRouter` contract in the genesis resources charges the same fee. If a staking contract is configured, it sends part of each USDST fee (the staking contract's `proposerFeeBps`) to that contract for the block proposer's pool, and the rest to FeeCollector. Block rewards are paid through a separate hook; see [Consensus](consensus.md).

### Cost of multi-transaction requests

The fee applies per transaction, so:

- A Bloc request with N transactions costs N × 0.01 USDST (or N vouchers). The same applies to `/transaction/parallel`.
- Many app actions send two transactions (an approval, then the action), which costs 0.02 USDST.

Check your voucher balance with `GET /api/vouchers/balance`.

!!! note "$STRATO and fees"
    The planned design is for $STRATO to pay for gas (see [Tokenomics](../tokenomics.md)). Today fees are paid in USDST or vouchers.

## Simulation and Tracing

| Tool | Use |
|------|-----|
| `POST /bloc/v2.2/transaction/simulate` | Dry-run a Bloc transaction body. No token is needed (pass `address` in the body). Add `?trace` for a call-frame trace (single transaction only) and `?username=` to simulate through your User wallet. The result has `status`, `gasUsed`, `response`, `events`, `error` and `trace`. Rate-limited per client. |
| `eth_call` | Read-only function calls through [JSON-RPC](../reference/json-rpc.md) |
| `strato_simulateV1`, `strato_traceCall`, `strato_traceTransaction`, `strato_traceBlock*` | Sandboxed simulation and tracing over JSON-RPC. Blocked on public `/rpc` unless the node runs with `--publicStratoRpc`. |
| `debug_traceBlockByHash` | Call frames for a mined block, from stored results |

## Transaction Results

Submitting returns a transaction hash right away. Follow it with any of these:

| Endpoint | Pending | Done |
|----------|---------|------|
| `GET /bloc/v2.2/transactions/{hash}/result` | `"status": "Pending"` | `"Success"` or `"Failure"`, with `txResult` |
| `POST /bloc/v2.2/transactions/results` (body: array of hashes) | same | same |
| `GET /strato-api/eth/v1.2/transactionResult/{hash}` | `[]` | `[{ "status": "success", "message": "Success!", ... }]` |
| `eth_getTransactionReceipt` | `null` | Receipt with `status` and `logs` |

Adding `?resolve` to Bloc submit or result calls makes the server wait up to about 10 seconds before it responds. For longer waits, poll every few seconds.

```bash
curl -s "https://app.testnet.strato.nexus/bloc/v2.2/transactions/<hash>/result"
```

```json
{
  "status": "Success",
  "hash": "23f5f4a7a87ac571ba473ee7659fa14bc72da954213b273b56128227b9ac1025",
  "txResult": {
    "status": "success",
    "message": "Success!",
    "blockHash": "f857bcd50750f99e4a8138d47cfd40b602fc31b5987229afae972316edf4bdad",
    "contractsCreated": []
  },
  "data": null
}
```

On `Failure`, `txResult.message` holds the revert reason.

## Related Docs

- [Core Platform API](../reference/strato-node-api.md)
- [JSON-RPC](../reference/json-rpc.md)
- [Identity & Vault](identity-and-vault.md)
- [Consensus](consensus.md)
- [Tokenomics](../tokenomics.md)
