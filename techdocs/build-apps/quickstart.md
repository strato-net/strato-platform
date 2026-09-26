# Developer Quick Start

Read STRATO data without credentials, then send your first transaction.

Develop against **testnet**:

| | Testnet (helium) | Mainnet (upquark) |
|---|---|---|
| Host | `https://app.testnet.strato.nexus` | `https://app.strato.nexus` |
| JSON-RPC | `https://app.testnet.strato.nexus/rpc` | `https://app.strato.nexus/rpc` or `https://noderpc.strato.nexus/rpc` |
| Chain ID | `195049586845898` (`0xb165855668ca`) | `123354377739506` (`0x7030addddcf2`) |

!!! info "Fees"
    Every transaction costs **0.01 USDST**, or **one voucher** if the sender holds one. The fee is charged before execution, so reverted transactions still pay. You don't need ETH and there is no gas price to tune. See [Transactions and Fees](../platform/transactions-and-fees.md).

---

## 1. Read public data (no credentials)

**Cirrus** returns indexed contract state as JSON:

```bash
curl -s "https://app.testnet.strato.nexus/cirrus/search/BlockApps-Token?address=eq.937efa7e3a77e20bbdbd7c0d32b6514f368c1010&select=address,_name,_symbol,customDecimals"
```

```json
[{"address":"937efa7e3a77e20bbdbd7c0d32b6514f368c1010","_name":"USDST","_symbol":"USDST","customDecimals":18}]
```

**JSON-RPC** uses the standard Ethereum protocol:

```bash
curl -s -X POST https://app.testnet.strato.nexus/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

```json
{"id":1,"jsonrpc":"2.0","result":"0xb165855668ca"}
```

The **core API** returns node metadata, including `networkName`, `networkID`, `chainId` and `isSynced`:

```bash
curl -s https://app.testnet.strato.nexus/strato-api/eth/v1.2/metadata
```

---

## 2. Read a contract with viem

```bash
mkdir my-strato-app && cd my-strato-app
npm init -y
npm install viem axios
npm install -D tsx typescript
```

Create `chain.ts`:

```typescript
import { defineChain } from "viem";

export const stratoTestnet = defineChain({
  id: 195049586845898,
  name: "STRATO Testnet",
  // Label only: fees are charged in USDST or vouchers, not through gas.
  nativeCurrency: { name: "USDST", symbol: "USDST", decimals: 18 },
  rpcUrls: { default: { http: ["https://app.testnet.strato.nexus/rpc"] } },
});

export const USDST = "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
```

Create `read.ts`:

```typescript
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { stratoTestnet, USDST } from "./chain";

async function main() {
  const client = createPublicClient({ chain: stratoTestnet, transport: http() });

  const symbol = await client.readContract({ address: USDST, abi: erc20Abi, functionName: "symbol" });
  const balance = await client.readContract({
    address: USDST,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: ["0x000000000000000000000000000000000000100d"], // FeeCollector
  });

  console.log(symbol, formatUnits(balance, 18));
}

main().catch(console.error);
```

```bash
npx tsx read.ts
```

---

## 3. Send your first transaction

Choose how the transaction gets signed.

### Option A: sign with your own key (JSON-RPC)

The sending address needs enough USDST for the amount plus the fee.

Create `send.ts`:

```typescript
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stratoTestnet, USDST } from "./chain";

async function main() {
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const wallet = createWalletClient({ account, chain: stratoTestnet, transport: http() });
  const client = createPublicClient({ chain: stratoTestnet, transport: http() });

  const hash = await wallet.writeContract({
    address: USDST,
    abi: erc20Abi,
    functionName: "transfer",
    args: [process.env.RECIPIENT as `0x${string}`, parseUnits("1", 18)],
    // STRATO accepts legacy (EIP-155) transactions. The fee is not gas-based.
    type: "legacy",
    gasPrice: 0n,
    gas: 1_000_000n,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(hash, receipt.blockNumber);
}

main().catch(console.error);
```

```bash
PRIVATE_KEY=0x... RECIPIENT=0x... npx tsx send.ts
```

### Option B: use a STRATO account (OIDC token, Vault signing)

The node signs with your account's key in Vault, so no private key lives in your code.

1. Request OAuth client credentials (client ID and secret) at [support.blockapps.net](https://support.blockapps.net).
2. Your account's first authenticated request creates its Vault key. Fund that address with USDST or vouchers before sending transactions.

Create `api.ts`:

```typescript
import axios from "axios";

const HOST = "https://app.testnet.strato.nexus";
const DISCOVERY_URL =
  "https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration";

async function getAccessToken(): Promise<string> {
  const { data: oidc } = await axios.get(DISCOVERY_URL);
  const { data } = await axios.post(
    oidc.token_endpoint,
    new URLSearchParams({ grant_type: "client_credentials" }),
    { auth: { username: process.env.OAUTH_CLIENT_ID!, password: process.env.OAUTH_CLIENT_SECRET! } },
  );
  return data.access_token;
}

async function main() {
  const token = await getAccessToken();
  const api = axios.create({
    baseURL: `${HOST}/api`,
    headers: { Authorization: `Bearer ${token}` },
  });

  const { data: me } = await api.get("/user/me");
  console.log("My address:", me.userAddress);

  const { data: result } = await api.post("/tokens/transfer", {
    address: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010", // USDST
    to: process.env.RECIPIENT,
    value: "1000000000000000000", // 1 USDST in base units
  });
  console.log(result); // { status, hash }
}

main().catch((e) => console.error(e.response?.data ?? e));
```

```bash
OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... RECIPIENT=... npx tsx api.ts
```

!!! warning "Use an API client for server-side POSTs"
    nginx runs a CSRF check on `POST`, `PUT`, `PATCH` and `DELETE`. It skips the check only when the `User-Agent` looks like an API client (for example `axios/`, `curl/`, `node-fetch` or `python-requests/`). Node's built-in `fetch` sends `User-Agent: node`, so nginx treats it as a browser and rejects it with 403. Use axios (as these examples do), curl or requests. JSON-RPC (`/rpc`) and Cirrus `GET` requests are not affected.

---

## Next steps

- [Integration Guide](integration.md): all five integration options in detail
- [E2E Examples](e2e.md): complete scripts
- [Contract Addresses](contract-addresses.md)
- [Quick Reference](quick-reference.md)
