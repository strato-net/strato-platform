# JSON-RPC

Every STRATO node serves an Ethereum-compatible JSON-RPC API at `/rpc`. Wallets (MetaMask, the STRATO wallet extension) and EVM libraries (viem, ethers) use it to read chain data and submit signed transactions.

The API is **on by default**: the `ethereum-jsonrpc` process listens on port 8545 on the host's container-facing address (`apiConfig.apiListenAddress`, never a public interface) and nginx proxies `/rpc` to it. Node operators can turn it off with `--jsonrpc=false`.

## Endpoints

| Network | URL |
|---------|-----|
| Mainnet (upquark), public endpoint | `https://noderpc.strato.nexus/rpc` |
| Mainnet (upquark), app node | `https://app.strato.nexus/rpc` |
| Testnet (helium) | `https://app.testnet.strato.nexus/rpc` |
| Your node | `https://<your-node-host>/rpc` |

Send requests as HTTP `POST` with `Content-Type: application/json`. Batch requests (a JSON array) are supported. There is no WebSocket endpoint and no subscriptions.

```bash
curl -s -X POST https://noderpc.strato.nexus/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

## Chain IDs

| Network | `eth_chainId` | Decimal | `net_version` (network ID) |
|---------|---------------|---------|----------------------------|
| Mainnet (upquark) | `0x7030addddcf2` | `123354377739506` | `33056204878082667` |
| Testnet (helium) | `0xb165855668ca` | `195049586845898` | `114784819836269` |

!!! warning "Use `eth_chainId`, not `net_version`"
    `net_version` returns STRATO's network ID. That is a different number from the EIP-155 chain ID, and it is larger than JavaScript's `Number.MAX_SAFE_INTEGER`. Wallets and signing libraries need the chain ID.

## Supported Methods

### Chain and account reads

| Method | Notes |
|--------|-------|
| `eth_chainId`, `net_version`, `web3_clientVersion`, `web3_sha3` | |
| `eth_blockNumber` | |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | Block tags such as `latest` are accepted |
| `eth_getBlockTransactionCountByNumber`, `eth_getBlockTransactionCountByHash` | |
| `eth_getBalance` | The account's **USDST** balance (the native token), read through the token contract. The block parameter is ignored. |
| `eth_getTransactionCount` | The account's current nonce. The block parameter is ignored. |
| `eth_getCode` | `0x01` if the address is a contract, otherwise `0x`. SolidVM contracts have no EVM bytecode to return. |
| `eth_call` | Runs a read-only call in the VM. Block tag: `latest`, `pending`, a block number or a block hash. Returns error code `3` if the VM doesn't answer within 30 s. |
| `eth_getTransactionByHash`, `eth_getTransactionByBlockHashAndIndex`, `eth_getTransactionByBlockNumberAndIndex` | |
| `eth_getTransactionReceipt`, `eth_getBlockReceipts` | Receipts include `status` and `logs` |
| `eth_getLogs` | Filter by `address`, `topics`, `fromBlock` and `toBlock`. At most 10,000 blocks per query and at most 1,000 matching events. Narrow the range if you hit a limit. |
| `debug_traceBlockByHash` | Call frames read from stored results (no re-execution) |

### Writes

| Method | Notes |
|--------|-------|
| `eth_sendRawTransaction` | Accepts a signed legacy Ethereum transaction (EIP-155 or pre-155 `v`) or a signed STRATO transaction, and returns the transaction hash. See [Transactions & Fees](../platform/transactions-and-fees.md). |

### Fixed responses

These methods exist for wallet compatibility and always return the same value:

- `eth_gasPrice` returns `0x0`.
- `eth_estimateGas` always returns `0x5208`.
- `eth_syncing` and `eth_mining` return `"false"`.
- `net_listening` returns `"true"`.
- `net_peerCount` and `eth_hashrate` return `0x0`.
- `eth_coinbase` returns the zero address.
- `eth_accounts` and `eth_getCompilers` return `"[]"`.
- The uncle methods return `0x0` or `null`.
- `eth_protocolVersion` returns a constant.
- `rpc_modules` returns a fixed list of module names that doesn't reflect which methods are implemented.

### Not supported

These return error `-32601`:

- `eth_sendTransaction` and `eth_sign`. The node holds no keys; sign in the client and use `eth_sendRawTransaction`.
- `eth_getStorageAt`
- Filters: `eth_newFilter`, `eth_newBlockFilter`, `eth_newPendingTransactionFilter`, `eth_getFilterChanges`, `eth_getFilterLogs`, `eth_uninstallFilter`. Use `eth_getLogs` instead.
- `eth_compileSolidity`, `eth_compileLLL`, `eth_compileSerpent`
- `eth_getWork`, `eth_submitWork`, `eth_submitHashrate`

Any method not listed here returns `Method not found`. That includes `eth_subscribe`, EIP-1559 fee methods and `txpool_*`.

## STRATO Extensions (`strato_*`)

| Method | Parameters | Purpose |
|--------|------------|---------|
| `strato_simulateV1` | `payload`, `blockTag` | Runs calls in sequence in one sandbox (shaped like `eth_simulateV1`; `stateOverrides` and `blockOverrides` are not supported) |
| `strato_traceCall` | `txObject`, `blockTag`, `traceConfig` | Traces a call without committing it |
| `strato_traceTransaction` | `txHash`, `traceConfig` | Re-executes and traces a mined transaction |
| `strato_traceBlockByHash`, `strato_traceBlockByNumber` | block, `traceConfig` | Traces every transaction in a block |
| `strato_traceBlock` | `rlpBlock`, `traceConfig` | Traces an RLP-encoded block |
| `strato_getFinalizedHeader` | `blockNumber` | Signed block header for light-client verification |
| `strato_getReceiptProof` | `blockNumber`, `txIndex` | Receipt inclusion proof |

!!! warning "Blocked on public `/rpc`"
    `strato_*` methods re-execute transactions in the VM, so nginx blocks the whole namespace on `/rpc` by default. They return HTTP `403` with JSON-RPC error `-32601` ("method not available on the public RPC endpoint"). A batch that includes any `strato_*` call is rejected as a whole.

    To simulate on public nodes, use the Bloc [`/transaction/simulate`](strato-node-api.md#build-sign-and-simulate) endpoint instead. An operator can expose `strato_*` on their own node with `--publicStratoRpc`.

## Wallet Setup

To add STRATO to MetaMask or another EIP-1193 wallet, open **Add network → Add a network manually** and enter:

| Field | Mainnet | Testnet |
|-------|---------|---------|
| Network name | STRATO | STRATO Helium |
| RPC URL | `https://noderpc.strato.nexus/rpc` | `https://app.testnet.strato.nexus/rpc` |
| Chain ID | `123354377739506` | `195049586845898` |
| Currency symbol | `USDST` | `USDST` |
| Block explorer | `https://stratoscan.strato.nexus` | `https://stratoscan.testnet.strato.nexus` |

What to expect:

- **Balance:** the wallet's native balance is your USDST balance.
- **Gas:** the wallet shows a gas price of 0. The real fee is 0.01 USDST or one voucher per transaction, charged on-chain by the Decider contract, not through gas. See [Transactions & Fees](../platform/transactions-and-fees.md#fees).
- **Transactions:** the STRATO app has MetaMask sign transactions with EIP-712 through your on-chain User wallet. You don't have to send Ethereum-format transactions yourself.

## Library Examples

Both examples were checked against testnet.

=== "viem"

    ```ts
    import { createPublicClient, defineChain, http, parseAbi } from "viem";

    const stratoHelium = defineChain({
      id: 195049586845898,
      name: "STRATO Helium",
      nativeCurrency: { name: "USDST", symbol: "USDST", decimals: 18 },
      rpcUrls: { default: { http: ["https://app.testnet.strato.nexus/rpc"] } },
    });

    const client = createPublicClient({ chain: stratoHelium, transport: http() });

    const blockNumber = await client.getBlockNumber();
    const symbol = await client.readContract({
      address: "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010", // USDST
      abi: parseAbi(["function symbol() view returns (string)"]),
      functionName: "symbol",
    });
    console.log(blockNumber, symbol); // ... "USDST"
    ```

=== "ethers v6"

    ```ts
    import { Contract, JsonRpcProvider } from "ethers";

    const provider = new JsonRpcProvider(
      "https://app.testnet.strato.nexus/rpc",
      195049586845898,
      { staticNetwork: true },
    );

    const usdst = new Contract(
      "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
      ["function decimals() view returns (uint8)"],
      provider,
    );
    console.log(await provider.getBlockNumber(), await usdst.decimals()); // ... 18n
    ```

## Related Docs

- [Core Platform API](strato-node-api.md): REST access to blocks, transactions and contract state
- [Cirrus](cirrus.md): indexed contract data
- [Transactions & Fees](../platform/transactions-and-fees.md)
