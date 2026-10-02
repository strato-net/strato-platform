# End-to-End Examples

Three complete TypeScript scripts, one per integration style:

1. [Portfolio snapshot](#example-1-portfolio-snapshot-cirrus-no-credentials): reads Cirrus, no credentials
2. [CDP bot](#example-2-cdp-bot-oidc-token-vault-signing-via-bloc): deposits collateral and mints USDST with Vault signing through Bloc
3. [Self-custody swap](#example-3-self-custody-swap-json-rpc-with-viem): approves and swaps with your own key over JSON-RPC

All three target testnet. Setup:

```bash
npm init -y
npm install viem axios
npm install -D tsx typescript
```

!!! info "Fees"
    Each transaction costs 0.01 USDST, or one voucher. Approve plus an action is two transactions, so it costs 0.02. Reverted transactions still pay. See [Transactions and Fees](../platform/transactions-and-fees.md).

---

## Example 1: Portfolio snapshot (Cirrus, no credentials)

This script prints a user's token balances and CDP vaults. Cirrus `GET` requests need no token.

```typescript
// portfolio.ts
import { formatUnits } from "viem";

const CIRRUS = "https://app.testnet.strato.nexus/cirrus/search";
const CDP_ENGINE = "0000000000000000000000000000000000001011";

async function cirrus<T>(table: string, params: Record<string, string>): Promise<T[]> {
  const res = await fetch(`${CIRRUS}/${table}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

interface BalanceRow {
  address: string;
  balance: string;
  token: { _name: string; _symbol: string; customDecimals: number } | null;
}

interface VaultRow {
  asset: string;
  Vault: { collateral: string; scaledDebt: string };
}

async function main(user: string) {
  const who = user.replace(/^0x/, "").toLowerCase();

  const balances = await cirrus<BalanceRow>("BlockApps-Token-_balances", {
    key: `eq.${who}`,
    select: "address,balance:value::text,token:BlockApps-Token(_name,_symbol,customDecimals)",
  });
  for (const b of balances) {
    if (b.balance === "0") continue;
    const decimals = b.token?.customDecimals ?? 18;
    console.log(`${b.token?._symbol ?? b.address}: ${formatUnits(BigInt(b.balance), decimals)}`);
  }

  const vaults = await cirrus<VaultRow>("BlockApps-CDPEngine-vaults", {
    address: `eq.${CDP_ENGINE}`,
    key: `eq.${who}`,
    select: "asset:key2,Vault:value",
  });
  for (const v of vaults) {
    console.log(`CDP vault ${v.asset}: collateral=${v.Vault.collateral} scaledDebt=${v.Vault.scaledDebt}`);
  }
}

main(process.argv[2]).catch(console.error);
```

```bash
npx tsx portfolio.ts <user address>
```

`scaledDebt` is stored scaled. For current debt, health factor and liquidation data, use the app API (`GET /api/cdp/vaults` with a token), or follow the math in `app/backend/src/api/services/cdp.service.ts`.

---

## Example 2: CDP bot (OIDC token, Vault signing via Bloc)

A service account deposits collateral into a CDP vault and mints USDST. The node signs with the account's Vault key. The script follows the steps in `app/backend/src/api/services/cdp.service.ts`.

Prerequisites:

- OAuth client credentials from [support.blockapps.net](https://support.blockapps.net)
- The account's address holds the collateral token, plus USDST or vouchers for three fees
- The collateral is a supported CDP asset (see `GET /api/cdp/assets`)

```typescript
// cdp-bot.ts
import axios from "axios";

const HOST = "https://app.testnet.strato.nexus";
const DISCOVERY_URL =
  "https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration";

const USDST = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const VOUCHER = "000000000000000000000000000000000000100e";
const CDP_REGISTRY = "0000000000000000000000000000000000001012";
const FEE = 10n ** 16n; // 0.01 USDST

async function getAccessToken(): Promise<string> {
  const { data: oidc } = await axios.get(DISCOVERY_URL);
  const { data } = await axios.post(
    oidc.token_endpoint,
    new URLSearchParams({ grant_type: "client_credentials" }),
    { auth: { username: process.env.OAUTH_CLIENT_ID!, password: process.env.OAUTH_CLIENT_SECRET! } },
  );
  return data.access_token;
}

async function cirrus(table: string, params: Record<string, string>) {
  const { data } = await axios.get(`${HOST}/cirrus/search/${table}`, { params });
  return data;
}

async function balanceOf(table: string, contract: string, user: string): Promise<bigint> {
  const rows = await cirrus(table, { address: `eq.${contract}`, key: `eq.${user}`, select: "value::text" });
  return BigInt(rows[0]?.value ?? "0");
}

// Same rule as app/backend/src/utils/txBuilder.ts: one voucher (1e18) covers one 0.01 USDST fee.
async function ensureFees(user: string, txCount: number) {
  const usdst = await balanceOf("BlockApps-Token-_balances", USDST, user);
  const vouchers = await balanceOf("BlockApps-Voucher-_balances", VOUCHER, user);
  if (usdst + vouchers / 100n < FEE * BigInt(txCount)) throw new Error("Not enough USDST or vouchers for fees");
}

async function submit(token: string, calls: { contractAddress: string; method: string; args: object }[]) {
  const { data } = await axios.post(
    `${HOST}/bloc/v2.2/transaction/parallel?resolve=true`,
    { txs: calls.map((payload) => ({ type: "FUNCTION", payload })), txParams: { gasLimit: 32100000000, gasPrice: 1 } },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const hashes: string[] = data.map((r: { hash: string }) => r.hash);

  for (const start = Date.now(); Date.now() - start < 60_000; ) {
    const { data: results } = await axios.post(`${HOST}/bloc/v2.2/transactions/results`, hashes);
    const failed = results.find((r: any) => r.status === "Failure");
    if (failed) throw new Error(failed.txResult?.message ?? "Transaction failed");
    if (results.every((r: any) => r.status !== "Pending")) return results;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for results");
}

async function main() {
  const [asset, amount, mintAmount] = process.argv.slice(2); // base-unit integer strings
  const token = await getAccessToken();

  const { data: me } = await axios.get(`${HOST}/api/user/me`, { headers: { Authorization: `Bearer ${token}` } });
  const user: string = me.userAddress;
  console.log("Account:", user);

  const [cdp] = await cirrus("BlockApps-CDPRegistry", {
    address: `eq.${CDP_REGISTRY}`,
    select: "cdpEngine,cdpVault",
  });

  await ensureFees(user, 3);

  await submit(token, [
    { contractAddress: asset, method: "approve", args: { spender: cdp.cdpVault, value: amount } },
    { contractAddress: cdp.cdpEngine, method: "deposit", args: { asset, amount } },
  ]);
  console.log("Deposited collateral");

  await submit(token, [
    { contractAddress: cdp.cdpEngine, method: "mint", args: { asset, amountUSD: mintAmount } },
  ]);
  console.log("Minted USDST");
}

main().catch((e) => console.error(e.response?.data ?? e.message));
```

```bash
OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... npx tsx cdp-bot.ts <collateral token address> <amount> <USDST to mint>
```

`mint` reverts in three cases: the new debt would exceed the collateral's borrowing limit (`CDPEngine: insufficient collateral`), it would exceed the asset's debt ceiling, or it would leave the vault below the asset's debt floor. The app backend's `POST /api/cdp/get-max-mint` endpoint calculates the maximum amount you can mint.

---

## Example 3: Self-custody swap (JSON-RPC with viem)

This script swaps USDST for ETH in the genesis ETH/USDST pool (`…1017`), signing with a local private key. The pool's `tokenA` is ETH and `tokenB` is USDST, so selling USDST means `isAToB = false`. The signing address pays the fees.

```typescript
// swap.ts
import {
  createPublicClient, createWalletClient, defineChain, erc20Abi, http, parseAbi, parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const stratoTestnet = defineChain({
  id: 195049586845898,
  name: "STRATO Testnet",
  nativeCurrency: { name: "USDST", symbol: "USDST", decimals: 18 }, // label only
  rpcUrls: { default: { http: ["https://app.testnet.strato.nexus/rpc"] } },
});

const USDST = "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const POOL = "0x0000000000000000000000000000000000001017"; // ETH / USDST
const CIRRUS = "https://app.testnet.strato.nexus/cirrus/search";

const poolAbi = parseAbi([
  "function swap(bool isAToB, uint256 amountIn, uint256 minAmountOut, uint256 deadline) returns (uint256)",
]);

const legacy = { type: "legacy", gasPrice: 0n, gas: 1_000_000n } as const;

async function main() {
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: stratoTestnet, transport: http() });
  const wallet = createWalletClient({ account, chain: stratoTestnet, transport: http() });

  const amountIn = parseUnits(process.argv[2] ?? "10", 18);

  // Estimate the output from pool balances in Cirrus, then allow 1% slippage.
  const [pool] = await (
    await fetch(`${CIRRUS}/BlockApps-Pool?address=eq.${POOL.slice(2)}&select=tokenABalance::text,tokenBBalance::text`)
  ).json();
  const reserveIn = BigInt(pool.tokenBBalance);  // USDST
  const reserveOut = BigInt(pool.tokenABalance); // ETH
  const estimatedOut = (amountIn * reserveOut) / (reserveIn + amountIn);
  const minAmountOut = (estimatedOut * 99n) / 100n;

  let nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "latest" });

  const approveHash = await wallet.writeContract({
    address: USDST, abi: erc20Abi, functionName: "approve", args: [POOL, amountIn], nonce: nonce++, ...legacy,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const swapHash = await wallet.writeContract({
    address: POOL, abi: poolAbi, functionName: "swap",
    args: [false, amountIn, minAmountOut, deadline], nonce: nonce++, ...legacy,
  });
  await publicClient.waitForTransactionReceipt({ hash: swapHash });

  console.log("Swapped", swapHash);
}

main().catch(console.error);
```

```bash
PRIVATE_KEY=0x... npx tsx swap.ts 10
```

The estimate above ignores the pool fee. For exact quotes across all pool types, use `GET /api/trade/quote`.

---

## Next steps

- [Integration Guide](integration.md)
- [Quick Reference](quick-reference.md)
- [Contract Addresses](contract-addresses.md)
