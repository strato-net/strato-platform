# Core Platform API (Advanced)

Every STRATO node exposes two REST APIs from its `strato-api` process:

- **Core API** (`/strato-api/eth/v1.2`): blocks, accounts, transactions, results, receipts, and submitting signed transactions.
- **Bloc API** (`/bloc/v2.2`): contract metadata and state by contract name, plus building, signing, simulating and tracking transactions.

!!! tip "Other node interfaces"
    - **[Cirrus](cirrus.md)**: SQL-style queries over indexed contract state and events (`/cirrus/search`)
    - **[JSON-RPC](json-rpc.md)**: Ethereum-compatible `/rpc` for wallets and EVM tooling
    - **[Transactions & Fees](../platform/transactions-and-fees.md)**: transaction types, signing paths, nonces, fees
    - **[Interactive API](interactive-api.md#core-and-bloc-api)**: OpenAPI spec and Swagger UI for both APIs

For DeFi operations (lending, swaps, CDP, rewards), use the **[App API](api.md)**.

## Base URLs

| Network | Core API | Bloc API |
|---------|----------|----------|
| Mainnet (upquark) | `https://app.strato.nexus/strato-api/eth/v1.2` | `https://app.strato.nexus/bloc/v2.2` |
| Testnet (helium) | `https://app.testnet.strato.nexus/strato-api/eth/v1.2` | `https://app.testnet.strato.nexus/bloc/v2.2` |

On your own node, use `https://<your-node-host>` with the same paths.

## Authentication

- **Reads are permissionless.** No token is needed for any `GET`, for building unsigned transactions, for simulation, or for submitting a transaction you already signed (`POST /strato-api/eth/v1.2/transaction`).
- **Server-side signing needs a token.** `POST /bloc/v2.2/transaction`, `/transaction/parallel` and `/transaction/body` sign with the caller's key in the Vault, so they need an OAuth 2.0 access token:

```http
Authorization: Bearer <access_token>
```

nginx checks the JWT against the node's OpenID Connect provider. Public networks use Keycloak, realm `mercata`. An invalid or expired token gets HTTP `403`. See [App API authentication](api.md#authentication) to get a token, and [Identity & Vault](../platform/identity-and-vault.md) for how keys are managed.

---

## Core API

All paths are relative to `/strato-api/eth/v1.2`. Addresses and hashes are 40- and 64-character hex strings **without** a `0x` prefix.

| Method | Path | Returns |
|--------|------|---------|
| GET | `/account` | Account state (filtered) |
| GET | `/code/{codeHash}` | Contract source for a code hash |
| GET | `/block` | Blocks (filtered) |
| GET | `/block/last/{n}` | The latest `n` blocks |
| GET | `/transaction` | Transactions (filtered) |
| GET | `/transaction/last/{n}` | The latest `n` transactions |
| GET | `/transaction/last/queued` | Transactions received but not yet in a block |
| POST | `/transaction` | Submit a signed transaction, returns its hash |
| GET | `/transactionResult/{txHash}` | Execution results for a transaction |
| POST | `/transactionResult/batch` | Execution results for several hashes |
| GET | `/storage` | Raw contract storage entries (filtered) |
| GET | `/receipts/hash/{blockHash}` and `/receipts/number/{blockNumber}` | RLP-encoded receipts for a block |
| GET | `/receipts/hash/{blockHash}/proof/{txIndex}` and `/receipts/number/{blockNumber}/proof/{txIndex}` | Receipt plus inclusion proof and signed header |
| GET | `/metadata` | Network and validator metadata |
| GET | `/peers` | Connected peers |
| GET | `/stats/totaltx` | Total transaction count |

Filtered endpoints (`/account`, `/block`, `/transaction`, `/storage`) need at least one filter. Without one they return an error listing the accepted parameters. Each response holds at most 1,000 rows.

### Accounts

```
GET /account?address={address}
```

| Parameter | Meaning |
|-----------|---------|
| `address` | Exact address |
| `balance`, `minbalance`, `maxbalance` | Balance filters |
| `nonce`, `minnonce`, `maxnonce` | Nonce filters |
| `codeHash`, `contractName` | Contracts with this code hash or contract name |
| `external` | `true` for externally owned accounts only, `false` for contracts only |
| `search` | Comma-separated fragments matched against address and contract name |
| `limit`, `offset` | Paging |

```json
[
  {
    "address": "0000000000000000000000000000000000dec1de",
    "balance": "0",
    "codeHash": "ff78f02586885867cd1c7d114267826e342fd44102416adac9e3c656afdf6b69",
    "contractName": "Decider",
    "contractRoot": "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    "kind": "AddressStateRef",
    "latestBlockNum": 0,
    "nonce": 0
  }
]
```

Use `nonce` from this response as the next nonce when you sign transactions yourself.

### Blocks

```
GET /block?number={n}
GET /block/last/{n}
```

| Parameter | Meaning |
|-----------|---------|
| `number`, `minnumber`, `maxnumber` | Block number filters |
| `hash` | Block hash |
| `txaddress` | Blocks with a transaction from or to this address |
| `coinbase` | Blocks with this coinbase |
| `gasused`, `mingasused`, `maxgasused`, `gaslim`, `mingaslim`, `maxgaslim` | Gas filters |
| `search` | Comma-separated fragments matched against block hash and coinbase |
| `sortby` | `asc` or `desc` by block number |

Response (trimmed, testnet):

```json
[
  {
    "blockHash": "f857bcd50750f99e4a8138d47cfd40b602fc31b5987229afae972316edf4bdad",
    "blockData": {
      "number": 574110,
      "parentHash": "f722840702966d75e55ada46696f60f54d22ceeab7b2bbfade6b11f875072763",
      "stateRoot": "053ab493...",
      "transactionsRoot": "1540c1d8...",
      "receiptsRoot": "f40701a0...",
      "timestamp": "2026-09-15T18:50:17Z",
      "currentValidators": ["0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82", "..."],
      "proposalSignature": { "r": "...", "s": "...", "v": 1 },
      "signatures": [{ "r": "...", "s": "...", "v": 0 }],
      "kind": "BlockData"
    },
    "receiptTransactions": [
      {
        "hash": "23f5f4a7a87ac571ba473ee7659fa14bc72da954213b273b56128227b9ac1025",
        "from": "72b572ed77397da1ece4768cb2fec1943e1af7cb",
        "to": "394d276e3b6109d6c58444653c26996bf3ae3eda",
        "funcName": "setLastProcessedBlock",
        "args": ["11155111", "11711698"],
        "nonce": 16970,
        "transactionType": "FunctionCall",
        "kind": "Transaction"
      }
    ],
    "kind": "Block"
  }
]
```

### Transactions

```
GET /transaction?hash={txHash}
GET /transaction/last/{n}
```

| Parameter | Meaning |
|-----------|---------|
| `hash` | Transaction hash |
| `address` | Sent from or to this address |
| `from`, `to` | Sender or recipient |
| `blocknumber`, `minblocknumber`, `maxblocknumber` | Block filters |
| `mintimestamp`, `maxtimestamp` | ISO 8601 time bounds |
| `gaslimit`, `mingaslimit`, `maxgaslimit` | Gas limit filters |
| `search` | Fragments matched against hash, addresses, args, function and contract name |
| `limit`, `offset` | Paging |
| `sortby` | `asc` or `desc` by block number and nonce |

```json
[
  {
    "hash": "23f5f4a7a87ac571ba473ee7659fa14bc72da954213b273b56128227b9ac1025",
    "blockNumber": 574110,
    "from": "72b572ed77397da1ece4768cb2fec1943e1af7cb",
    "to": "394d276e3b6109d6c58444653c26996bf3ae3eda",
    "funcName": "setLastProcessedBlock",
    "args": ["11155111", "11711698"],
    "nonce": 16970,
    "gasLimit": 32100000000,
    "transactionType": "FunctionCall",
    "timestamp": "2026-09-15T18:50:17.331742Z",
    "r": "5e1220ef...", "s": "34003b5c...", "v": "1b"
  }
]
```

Queued transactions (`/transaction/last/queued`) have `"blockNumber": -1`.

### Submit a signed transaction

```
POST /transaction
Content-Type: application/json
```

The body is a signed transaction in JSON, and the response is its hash as a JSON string. No token is needed because the node doesn't sign anything. This example is an EIP-712-signed function call, the format the STRATO wallet extension uses:

```json
{
  "nonce": 12,
  "gasLimit": 32100000000,
  "to": "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  "funcName": "transfer",
  "args": ["\"88a4d57a95421763c599fd4ae7449c34c6206966\"", "1000000000000000000"],
  "network": "STRATO",
  "r": "<64 hex chars>",
  "s": "<64 hex chars>",
  "v": "1b",
  "txVersion": 1
}
```

Requests larger than the node's `--txSizeLimit` are rejected. To build the unsigned fields, call [`POST /bloc/v2.2/transaction/unsigned`](#build-sign-and-simulate). To submit Ethereum-format RLP instead, use [`eth_sendRawTransaction`](json-rpc.md). [Transactions & Fees](../platform/transactions-and-fees.md) explains the signing formats.

### Transaction results

```
GET  /transactionResult/{txHash}
POST /transactionResult/batch        body: ["<hash>", "<hash>"]
```

`GET` returns `[]` until the transaction runs. `batch` returns an object keyed by hash.

```json
[
  {
    "transactionHash": "23f5f4a7a87ac571ba473ee7659fa14bc72da954213b273b56128227b9ac1025",
    "blockHash": "f857bcd50750f99e4a8138d47cfd40b602fc31b5987229afae972316edf4bdad",
    "status": "success",
    "message": "Success!",
    "contractsCreated": [],
    "contractsDeleted": [],
    "gasUsed": "00000000000000000000000000000000000000000000000000000007794f2100",
    "response": null,
    "time": 1.342080602
  }
]
```

### Storage

```
GET /storage?address={address}&limit=10
```

Parameters: `address`, `key`, `minkey`, `maxkey`, `value`, `minvalue`, `maxvalue`, `search`, `limit`, `offset`. For decoded state, use the Bloc [contract state](#contracts) endpoints or [Cirrus](cirrus.md).

### Receipts and proofs

`/receipts/...` returns `{ "blockHash", "receipts": ["0x<rlp>", ...] }` in transaction order.

`/receipts/.../proof/{txIndex}` returns `blockHash`, `blockNumber`, `txIndex`, `headerRLP`, the validator `signatures`, `receiptRLP`, `mptProof`, and `logs` (`contractAddress`, `eventName`, `args`). That is everything an off-chain client needs to prove a receipt against a signed header.

### Node info

`GET /metadata`:

```json
{
  "networkName": "helium",
  "networkID": "114784819836269",
  "chainId": "195049586845898",
  "isSynced": true,
  "validators": ["0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82", "..."],
  "urls": { "oauthDiscovery": "...", "vault": "...", "monitor": "...", "fileServer": "..." }
}
```

- `GET /peers` returns an object of peer IP to port.
- `GET /stats/totaltx` returns `{"transactionCount": 686181}`.

---

## Bloc API

All paths are relative to `/bloc/v2.2`.

### Contracts

| Method | Path | Returns |
|--------|------|---------|
| GET | `/contracts?name=&offset=&limit=` | Contract names with instance addresses and creation times |
| GET | `/contracts/{contractName}` | Addresses of that contract |
| GET | `/contracts/{contractName}/{address}` | Contract definition (functions, variables, events) |
| GET | `/contracts/contract/{address}/details` | Contract definition by address |
| GET | `/contracts/{contractName}/{address}/state` | Current state as `{ variable: value }` |
| GET | `/contracts/{contractName}/{address}/state/{mapping}/{key}` | One mapping entry |
| POST | `/contracts/states` | Batch state reads |
| GET | `/contracts/{contractName}/all/states` | State of every instance |
| GET | `/contracts/{contractName}/{address}/functions` | Function names |
| GET | `/contracts/{contractName}/{address}/symbols` | State variable names |
| GET | `/contracts/{contractName}/{address}/enum/{enumName}` | Enum values |
| POST | `/contracts/compile` | Compile SolidVM source: `[{contractName, source, vm}]` → `[{contractName, codeHash}]` |
| POST | `/contracts/xabi` | Extended ABI for source: `{ "src": "..." }` |

`/state` query options: `name` (one variable), `offset` and `count` (a slice of an array), and `length` (flag: return an array's length). `POST /contracts/states` takes `[{ "contractName", "address", "varName", "count", "offset", "length" }]`.

```bash
curl -s "https://app.testnet.strato.nexus/bloc/v2.2/contracts?name=Decider"
```

```json
{
  "Decider": [{ "address": "0000000000000000000000000000000000dec1de", "createdAt": 1789498413 }],
  "DeciderState": [{ "address": "00000000000000000000000000000000dec1de02", "createdAt": 1789498413 }]
}
```

### Transaction request body

Every transaction endpoint below takes the same body:

```json
{
  "address": "optional sender address (required for /unsigned and anonymous /simulate)",
  "txs": [
    {
      "type": "FUNCTION",
      "payload": {
        "contractAddress": "<contract address>",
        "method": "set",
        "args": { "_x": 5 }
      }
    }
  ],
  "txParams": { "gasLimit": 32100000000, "nonce": 12 }
}
```

| `type` | `payload` fields |
|--------|------------------|
| `FUNCTION` | `contractAddress`, `method`, `args` (object keyed by parameter name), optional `txParams`, `metadata` |
| `CONTRACT` | `src` (SolidVM source), `contract` (contract to deploy), `args`, optional `txParams`, `metadata` |
| `TRANSFER` | `toAddress`, optional `txParams`, `metadata` |

`txParams` fields are `gasLimit`, `gasPrice`, `nonce` and `attribution` (an optional hex suffix, such as ERC-8021). They can be set per payload or for the whole request. If you leave out `nonce`, Bloc assigns sequential nonces from the sender's account.

### Sign and submit (token required)

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/transaction` | Signs each tx with the caller's Vault key and submits it |
| POST | `/transaction/parallel` | Same as above, but nonces come from a short-lived (10 s) per-address cache so concurrent requests from one account don't collide |
| POST | `/transaction/body` | Signs but does **not** submit. Returns `[{ "hash", "raw" }]` |

Query parameters:

- `resolve`: wait for results. The server polls for up to about 10 seconds and returns whatever status it has by then.
- `username`: see [User wallet wrapping](#user-wallet-wrapping).

The node must be synced before it accepts these requests.

```json
[
  {
    "status": "Success",
    "hash": "23f5f4a7a87ac571ba473ee7659fa14bc72da954213b273b56128227b9ac1025",
    "txResult": { "status": "success", "message": "Success!", "blockHash": "f857bcd5...", "contractsCreated": [] },
    "data": { "tag": "Call", "contents": [] }
  }
]
```

`status` is `Pending`, `Success` or `Failure`. `data.tag` is `Call` (return values) for FUNCTION, `Upload` (`{name, address}`) for CONTRACT, or `Send` for TRANSFER.

`/strato/v2.3/transaction` is an alias of `/bloc/v2.2/transaction`.

### Build, sign and simulate

No token is needed for these.

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/transaction/unsigned` | Builds unsigned transactions for `address` and returns `[{ "hash", "data": { "nonce", "gasLimit", "to", "contractName", "functionName", "args", "network", "code", "chainId" } }]`. Sign them and submit to `POST /strato-api/eth/v1.2/transaction`. |
| POST | `/transaction/simulate` | Dry-runs the body in a VM sandbox. Nothing is signed or committed. Rate- and connection-limited per client (HTTP `429` when exceeded). |

`/transaction/simulate` query parameters:

- `username`: wrap the call as described below.
- `trace`: include a call-frame trace. Allowed only when the body has a single transaction.
- `chainid`: rejected, because simulation runs on the main chain only.

Each result has `status`, `gasUsed`, `response` (raw return value), `data`, `events` (`[{address, name, args}]`), `error`, `trace`, and `effect`. `effect` is filled only for governance `castVoteOnIssue` calls: the simulated action the vote would trigger.

### Results

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/transactions/{hash}/result?resolve` | One result, same shape as above |
| POST | `/transactions/results?resolve` | Body `["<hash>", ...]`, returns results in the same order |

### User wallet wrapping

If you pass `?username=<name>` to `/transaction`, `/transaction/parallel`, `/transaction/unsigned` or `/transaction/simulate`, each `CONTRACT` or `FUNCTION` transaction becomes a call to that user's on-chain User wallet contract (`createContract` or `callContract`). The wallet address is derived from the UserRegistry contract (`0x720`), with the username as the salt. External wallets use this with `/transaction/unsigned` to sign app transactions with EIP-712. See [Transactions & Fees](../platform/transactions-and-fees.md#signing-paths).

## Errors

- Failed requests return an HTTP error status with a message.
- An unknown path on `strato-api` returns `404` with the list of available routes.
- A transaction that ran but reverted still returns `200`. Check `status` and `txResult.message` in the result.

## Related Docs

- [Cirrus](cirrus.md): indexed contract data
- [JSON-RPC](json-rpc.md): Ethereum-compatible RPC
- [Transactions & Fees](../platform/transactions-and-fees.md)
- [App API](api.md): DeFi operations
- [Interactive API](interactive-api.md)
