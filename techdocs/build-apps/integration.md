# Integration Guide

There are five ways to integrate with STRATO. They differ in who holds the signing key and how much of the work the platform does for you.

| Option | Who signs | Auth | Use it for |
|---|---|---|---|
| [A. App REST API](#a-app-rest-api) (`/api`) | Your account's Vault key, server-side | OIDC bearer token | DeFi operations (transfers, swaps, CDP, bridge, rewards, staking) without building transactions |
| [B. Bloc](#b-bloc-with-vault-signing) (`/bloc/v2.2`) | Your account's Vault key, server-side | OIDC bearer token for submitting | Calling any contract function by name with JSON arguments |
| [C. JSON-RPC](#c-client-side-signing-over-json-rpc) (`/rpc`) | Your own key (viem, ethers) | None | Self-custody bots, scripts and dApps |
| [D. Cirrus](#d-cirrus-read-queries) (`/cirrus/search`) | Nobody (read-only) | None for reads | Indexed state, mappings and events |
| [E. External wallets](#e-external-wallets) | The user's wallet | Wallet connection | Browser dApps |

All examples use testnet (`https://app.testnet.strato.nexus`). For mainnet, use `https://app.strato.nexus`. Chain IDs and addresses are in the [Quick Reference](quick-reference.md).

!!! info "Fees"
    Each transaction costs **0.01 USDST**, or **one voucher** if the sender holds one. The fee is charged before execution, so reverted transactions still pay. Gas price doesn't affect the fee. A request that submits N transactions costs N fees, so approve plus an action costs 0.02 USDST. See [Transactions and Fees](../platform/transactions-and-fees.md).

---

## Authentication (options A and B)

STRATO uses OAuth 2.0 / OpenID Connect through Keycloak (realm `mercata`).

1. Request client credentials (client ID and secret) at [support.blockapps.net](https://support.blockapps.net).
2. Get an access token with the `client_credentials` grant.
3. Send it as `Authorization: Bearer <token>`.

```typescript
// auth.ts
import axios from "axios";

const DISCOVERY_URL =
  "https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration";

export async function getAccessToken(): Promise<string> {
  const { data: oidc } = await axios.get(DISCOVERY_URL);
  const { data } = await axios.post(
    oidc.token_endpoint,
    new URLSearchParams({ grant_type: "client_credentials" }),
    { auth: { username: process.env.OAUTH_CLIENT_ID!, password: process.env.OAUTH_CLIENT_SECRET! } },
  );
  return data.access_token; // cache it and refresh before `expires_in` runs out
}
```

What happens to the token:

- nginx verifies the JWT against the realm's keys. An invalid or expired token gets `403 Authorization header is provided but the bearer token is invalid or expired`.
- Vault identifies your account from the token. Your first authenticated request creates the account's signing key. Look up the address with `GET /api/user/me`.
- Never put the client secret in browser code.

See [Identity and Vault](../platform/identity-and-vault.md) for how accounts, keys and the on-chain UserRegistry fit together.

!!! warning "CSRF check and User-Agent"
    For `POST`/`PUT`/`PATCH`/`DELETE`, nginx skips its CSRF check only when the `User-Agent` identifies an API client (for example `axios/`, `curl/`, `node-fetch`, `python-requests/`, `Go-http-client`). Other requests are treated as browser requests and rejected with `403` if there is no browser session. Node's built-in `fetch` sends `User-Agent: node`, so use axios or another listed client for server-side writes.

---

## A. App REST API

The app backend is the API the STRATO web app itself uses. For write endpoints, the backend:

1. builds the transactions,
2. checks that you can cover the fees (otherwise it returns `Insufficient gas fee coverage`),
3. signs with your Vault key through Bloc, and
4. waits for the result.

- **OpenAPI spec (no login):** `GET /api/public/api-docs.json`
- **Swagger UI:** `/api/docs` (log in through the browser)
- **Public reads:** many `GET` endpoints work without a token. Endpoints that return user data need one.
- **Amounts:** integer strings in base units, for example `"1000000000000000000"` for 1 token with 18 decimals.

```typescript
import axios from "axios";
import { getAccessToken } from "./auth";

const api = axios.create({ baseURL: "https://app.testnet.strato.nexus/api" });
api.interceptors.request.use(async (config) => {
  config.headers.Authorization = `Bearer ${await getAccessToken()}`;
  return config;
});

const { data: me } = await api.get("/user/me"); // { userAddress, isAdmin, userName, isNewUser }

const { data: tx } = await api.post("/tokens/transfer", {
  address: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010", // token contract (USDST)
  to: "<recipient address>",
  value: "1000000000000000000",
});
// tx = { status: "Success", hash: "..." }
```

### Common endpoints

Check the OpenAPI spec for full request and response schemas.

| Method and path | Body or query | Purpose |
|---|---|---|
| `GET /user/me` | | Your address and username |
| `GET /tokens` | `select`, `status` | Token list |
| `GET /tokens/balance` | `address` | Your token balances |
| `GET /vouchers/balance` | | Your voucher balance |
| `POST /tokens/transfer` | `address`, `to`, `value` | Transfer a token |
| `POST /tokens/approve` | see spec | Approve a spender |
| `GET /oracle/price` | `asset` | Oracle prices |
| `GET /swap-pools` | `select`, `limit`, `offset`, `order` | Swap pools |
| `GET /trade/quote` | `tokenIn`, `tokenOut`, `amount`, `type` | Quotes across pools |
| `POST /swap` | `poolAddress`, `isAToB`, `amountIn`, `minAmountOut` | Swap in one pool |
| `POST /trade/swap` | `poolAddress`, `tokenIn`, `tokenOut`, `amountIn`, `minAmountOut` | Swap in any pool type |
| `GET /cdp/assets` | `supported` | CDP collateral assets |
| `GET /cdp/vaults` | | Your CDP vaults |
| `POST /cdp/deposit` | `asset`, `amount` | Deposit CDP collateral |
| `POST /cdp/mint` | `asset`, `amount` | Mint USDST against a vault |
| `POST /cdp/repay` | see spec | Repay USDST debt |
| `POST /bridge/requestWithdrawal` | `externalChainId`, `externalToken`, `stratoToken`, `stratoTokenAmount`, `externalRecipient` | Bridge out |
| `GET /rewards/overview` | | Rewards overview |
| `POST /rewards/claim-all` | | Claim all rewards |
| `GET /staking/info/public` | | Staking overview |

The lending-pool routes (`/lending/collateral`, `/lending/loans`, `/lending/pools/liquidity`, and others) are still served. The web app, however, currently offers borrowing only through CDP vaults.

Source: `app/backend/src/api/routes/*.routes.ts`.

---

## B. Bloc with Vault signing

Bloc builds a transaction from a contract address, method name and JSON arguments, signs it with your Vault key, and submits it. Bloc reads the ABI from the contract's source, so you don't supply one.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /bloc/v2.2/transaction/parallel?resolve=true` | Token | Sign and submit one or more transactions (used by the app backend) |
| `POST /bloc/v2.2/transaction?resolve=true` | Token | Sign and submit (same body) |
| `POST /bloc/v2.2/transactions/results` | None | Results for a JSON array of transaction hashes |
| `GET /bloc/v2.2/transactions/{hash}/result` | None | Result for one hash |
| `POST /bloc/v2.2/transaction/simulate` | None (rate-limited) | Dry-run the same body without committing. Add `?trace` for a trace. |
| `POST /bloc/v2.2/transaction/unsigned` | None | Build unsigned transactions for external signing. See [Transactions and Fees](../platform/transactions-and-fees.md). |

### Request body

```json
{
  "txs": [
    {
      "type": "FUNCTION",
      "payload": {
        "contractAddress": "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
        "method": "transfer",
        "args": { "to": "<recipient address>", "value": "1000000000000000000" }
      }
    }
  ],
  "txParams": { "gasLimit": 32100000000, "gasPrice": 1 }
}
```

- `type` is `FUNCTION`, `CONTRACT` (deploy: `payload` = `{ "contract": "Name", "src": "<Solidity source>", "args": { ... } }`) or `TRANSFER`.
- `args` is keyed by the Solidity parameter names.
- The `txParams` values shown are the ones the app backend sends. They don't change the fee.

### Response

A JSON array with one result per transaction:

```json
[{ "status": "Pending", "hash": "…", "txResult": null, "data": null }]
```

- `status` is `Success`, `Failure` or `Pending`.
- On failure, `txResult.message` has the reason.
- For function calls, `data.tag` is `"Call"` and `data.contents` holds the decoded return values.
- Some failures come back as an HTTP error whose body is the error message.

### Submit and wait

```typescript
// bloc.ts
import axios from "axios";

const BLOC = "https://app.testnet.strato.nexus/bloc/v2.2";

export interface Call {
  contractAddress: string;
  method: string;
  args: Record<string, unknown>;
}

export async function submit(token: string, calls: Call[]) {
  const { data } = await axios.post(
    `${BLOC}/transaction/parallel?resolve=true`,
    {
      txs: calls.map((payload) => ({ type: "FUNCTION", payload })),
      txParams: { gasLimit: 32100000000, gasPrice: 1 },
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return waitForResults(data.map((r: { hash: string }) => r.hash));
}

export async function waitForResults(hashes: string[], timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    const { data } = await axios.post(`${BLOC}/transactions/results`, hashes);
    const failed = data.find((r: any) => r.status === "Failure");
    if (failed) throw new Error(failed.txResult?.message ?? "Transaction failed");
    if (data.every((r: any) => r.status !== "Pending")) return data;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for results");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
```

### Example: deposit CDP collateral and mint USDST

The app backend runs these steps (`app/backend/src/api/services/cdp.service.ts`). Approve the **CDPVault** (`…1013`), then call **CDPEngine** (`…1011`):

```typescript
const CDP_ENGINE = "0000000000000000000000000000000000001011";
const CDP_VAULT = "0000000000000000000000000000000000001013";

await submit(token, [
  { contractAddress: asset, method: "approve", args: { spender: CDP_VAULT, value: amount } },
  { contractAddress: CDP_ENGINE, method: "deposit", args: { asset, amount } },
]);

await submit(token, [
  { contractAddress: CDP_ENGINE, method: "mint", args: { asset, amountUSD: mintAmount } },
]);
```

More call patterns, with their approve targets, are in the [Quick Reference](quick-reference.md#common-contract-calls).

---

## C. Client-side signing over JSON-RPC

You hold the private key, sign locally, and submit with `eth_sendRawTransaction`. No STRATO account or token is involved; the signing address pays the fee.

**Endpoints:** `https://app.testnet.strato.nexus/rpc` (testnet), and `https://app.strato.nexus/rpc` or `https://noderpc.strato.nexus/rpc` (mainnet).

**Transaction rules:**

- **Legacy (EIP-155) transactions only.** Don't send EIP-1559 / type-2 envelopes. `eth_feeHistory` and `eth_maxPriorityFeePerGas` aren't implemented, and blocks have no `baseFeePerGas`.
- Set `gasPrice: 0` and an explicit gas limit (the web app uses `1000000`).
- `eth_sendTransaction` isn't supported. Sign locally or use a wallet, and the transaction goes out through `eth_sendRawTransaction`.
- Public endpoints block `strato_*` methods (for example `strato_traceTransaction`) with `403`. Use `POST /bloc/v2.2/transaction/simulate` for dry runs.

Method list: [JSON-RPC reference](../reference/json-rpc.md).

### viem

```typescript
import {
  createPublicClient, createWalletClient, defineChain, erc20Abi, http, parseAbi, parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const stratoTestnet = defineChain({
  id: 195049586845898,
  name: "STRATO Testnet",
  nativeCurrency: { name: "USDST", symbol: "USDST", decimals: 18 }, // label only
  rpcUrls: { default: { http: ["https://app.testnet.strato.nexus/rpc"] } },
});

const USDST = "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: stratoTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: stratoTestnet, transport: http() });

// Read
const balance = await publicClient.readContract({
  address: USDST, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
});

// Write
const hash = await walletClient.writeContract({
  address: USDST,
  abi: erc20Abi,
  functionName: "transfer",
  args: ["0x<recipient>", parseUnits("1", 18)],
  type: "legacy",
  gasPrice: 0n,
  gas: 1_000_000n,
});
await publicClient.waitForTransactionReceipt({ hash });
```

### ethers

With ethers v6, set the legacy fields explicitly on every transaction: `type: 0`, `gasPrice: 0n`, and a `gasLimit`.

### ABIs for non-token contracts

Token contracts implement the ERC-20 functions, so `erc20Abi` works. For other contracts, write ABI fragments from the Solidity source in `app/contracts/concrete`:

```typescript
const cdpEngineAbi = parseAbi([
  "function deposit(address asset, uint256 amount)",
  "function mint(address asset, uint256 amountUSD)",
  "function repay(address asset, uint256 amountUSD)",
]);
```

---

## D. Cirrus read queries

Cirrus indexes contract state and events into Postgres and serves them through PostgREST at `/cirrus/search`. Only `GET` is allowed, and public nodes allow anonymous reads.

**Table names:**

| Data | Table | Columns |
|---|---|---|
| Contract state | `BlockApps-<Contract>` | `address` plus one column per state variable |
| Mapping | `BlockApps-<Contract>-<mapping>` | `address`, `key`, `key2` (nested mappings), `value` |
| Event | `BlockApps-<Contract>-<Event>` | `address` plus the event fields |

For example: `BlockApps-Token`, `BlockApps-Token-_balances`, `BlockApps-PoolFactory-allPools`, `BlockApps-MercataBridge-WithdrawalRequested`.

**Query syntax (PostgREST):**

- Filters: `column=eq.value`, `in.(a,b)`, `gt.0`
- Columns and renames: `select=alias:column`
- Casts: `::text` for large integers
- Ordering and paging: `order=column.desc`, `limit`, `offset`
- Embedding: through a foreign key, `lendingPool:lendingPool_fkey(address,borrowableAsset)`, or a table, `token:BlockApps-Token(_symbol)`

```bash
# A user's token balances with token metadata
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token-_balances?key=eq.<user address>&select=address,balance:value::text,token:BlockApps-Token(_name,_symbol,customDecimals)"

# One token balance
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token-_balances?address=eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010&key=eq.<user address>&select=value::text"

# A user's CDP vaults
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-CDPEngine-vaults?address=eq.0000000000000000000000000000000000001011&key=eq.<user address>&select=asset:key2,Vault:value"
```

A wrong table name returns a PostgREST error such as `{"code":"42P01", ... "does not exist"}`. Full reference: [Cirrus](../reference/cirrus.md).

---

## E. External wallets

### STRATO Wallet extension

The STRATO Wallet extension is a self-custody browser extension developed in its own
repository, [strato-net/strato-wallet](https://github.com/strato-net/strato-wallet). To
build it, clone that repository, run `npm install` and `npm run build`, then load
`.output/chrome-mv3` as an unpacked extension. It:

- announces itself through EIP-6963 (name `STRATO`) and sets `window.ethereum` if no other wallet has claimed it
- supports `eth_requestAccounts`, `eth_chainId`, `personal_sign`, `eth_signTypedData_v4`, `wallet_addEthereumChain` and `wallet_switchEthereumChain`, plus read methods proxied to the node
- handles `eth_sendTransaction` by signing a legacy EIP-155 transaction and submitting it with `eth_sendRawTransaction`
- exposes `window.strato.sendBlocTransaction({ type, payload, username? })`, which builds, signs and submits a STRATO-native Bloc transaction

### MetaMask and other EIP-1193 wallets

Add the STRATO network (chain ID and `/rpc` URL), then send legacy transactions with a zero gas price. The web app does this with wagmi (`app/ui/src/pages/Transfer.tsx`). It also passes an explicit nonce from `eth_getTransactionCount`.

```typescript
import { createWalletClient, custom, erc20Abi, parseUnits } from "viem";
import { stratoTestnet } from "./chain";

const wallet = createWalletClient({ chain: stratoTestnet, transport: custom(window.ethereum!) });
const [account] = await wallet.requestAddresses();
await wallet.addChain({ chain: stratoTestnet });

const hash = await wallet.writeContract({
  account,
  address: "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  abi: erc20Abi,
  functionName: "transfer",
  args: ["0x<recipient>", parseUnits("1", 18)],
  type: "legacy",
  gasPrice: 0n,
  gas: 1_000_000n,
});
```

The wallet address pays the fee, so it needs USDST or a voucher.

---

## Reference implementation

- `app/backend/src/utils/txBuilder.ts`: Bloc transaction builder and fee-coverage check
- `app/backend/src/utils/txHelper.ts`: submit, poll results, low-nonce retry
- `app/backend/src/utils/appApiHelper.ts`: API clients
- `app/backend/src/api/services/`: `tokens`, `cdp`, `lending`, `swapping`, `bridge`, `rewards` and `staking` services
- `app/ui/src/lib/stratoWallet.ts`, and `src/core/tx-evm.ts` in the
  [strato-wallet](https://github.com/strato-net/strato-wallet) repository: legacy
  transaction signing for `/rpc`

## Next steps

- [E2E Examples](e2e.md)
- [Quick Reference](quick-reference.md)
- [Contract Addresses](contract-addresses.md)
