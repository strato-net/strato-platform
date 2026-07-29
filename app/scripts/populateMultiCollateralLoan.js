/*
  Script: populateMultiCollateralLoan.js
  Purpose: Quickly create one or more unhealthy (liquidatable) loans backed by **multiple collateral assets**
           (GOLDST + SILVST) so the front-end Liquidations UI can test per-asset partial liquidations.

  Usage (example):
    ADMIN_TOKEN=<adminJwt>                      \
    BORROWER_TOKENS="<jwt1>,<jwt2>"            \
    STRATO_NODE_URL=https://node.example.com    \
    LENDING_POOL=<addr>                         \
    LIQUIDITY_POOL=<addr>                       \
    COLLATERAL_VAULT=<addr>                     \
    PRICE_ORACLE=<addr>                         \
    USDST=<addr> GOLDST=<addr> SILVST=<addr>    \
    node scripts/populateMultiCollateralLoan.js

  Env vars (all required):
    – STRATO_NODE_URL  or NODE_URL  : Strato base URL
    – ADMIN_TOKEN                    : JWT for an admin wallet (owns GOLD & USDST & SILV)
    – BORROWER_TOKENS (csv)          : JWTs for one or more borrower wallets
    – Contract addresses             : LENDING_POOL, LIQUIDITY_POOL, COLLATERAL_VAULT, PRICE_ORACLE, USDST, GOLDST, SILVST

  What it does (per borrower):
    1. Ensures LiquidityPool has ≥ 10 000 USDST liquidity.
    2. Resets oracle prices  (GOLD=$2 000, SILV=$25, USDST=$1).
    3. Supplies 1 GOLDST  + 50 SILVST as collateral (≈ $3 250 value).
    4. Borrows 2 500 USDST   (HF healthy before price drop).
    5. After all loans created, crashes prices to GOLD=$800 and SILV=$10 → HF < 1 → loans become liquidatable on **both** collaterals.

  The script prints each borrower address for easy copy-paste into the UI.
*/

const axios = require("axios");
require("dotenv").config();

(async () => {
  /* ---------- env + config ---------- */
  const node = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!node) throw new Error("Set STRATO_NODE_URL or NODE_URL env var");
  const ROOT = node.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN required");

  const BORROWER_TOKENS = (process.env.BORROWER_TOKENS || "")
    .split(/\s*,\s*/)
    .filter(Boolean);
  if (BORROWER_TOKENS.length === 0)
    throw new Error("Provide BORROWER_TOKENS (comma-separated JWTs)");

  const cfg = {
    LENDING_POOL: process.env.LENDING_POOL,
    LIQUIDITY_POOL: process.env.LIQUIDITY_POOL,
    COLLATERAL_VAULT: process.env.COLLATERAL_VAULT,
    PRICE_ORACLE: process.env.PRICE_ORACLE,
    USDST: process.env.USDST,
    GOLDST: process.env.GOLDST,
    SILVST: process.env.SILVST,
  };
  Object.entries(cfg).forEach(([k, v]) => {
    if (!v) throw new Error(`Missing env var ${k}`);
  });

  /* ---------- helpers ---------- */
  const headers = (tok) => ({
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
  });

  const buildCall = (name, addr, method, args = {}) => ({
    payload: {
      contractName: name,
      contractAddress: addr,
      method,
      args,
    },
    type: "FUNCTION",
  });

  const send = async (tok, txs) => {
    const body = {
      txs: Array.isArray(txs) ? txs : [txs],
      txParams: { gasPrice: 1, gasLimit: 32100000000 },
    };
    const { data } = await axios.post(txEndpoint, body, { headers: headers(tok) });
    // Ensure **all** transactions executed successfully – not just the first one
    const failed = data.findIndex((r) => r.status !== "Success");
    if (failed !== -1) {
      console.error("Batch TX failed", JSON.stringify(data, null, 2));
      throw new Error(`Tx index ${failed} failed: ${data[failed].error || data[failed].status}`);
    }
  };

  const cirrusGet = async (path, params) => {
    const url = `${ROOT}/cirrus/search${path}`;
    const { data } = await axios.get(url, {
      headers: headers(ADMIN_TOKEN),
      params,
    });
    return data;
  };

  const getBalance = async (tokenAddr, holderAddr) => {
    const rows = await cirrusGet("/BlockApps-Token-_balances", {
      address: `eq.${tokenAddr.toLowerCase()}`,
      key: `eq.${holderAddr.toLowerCase()}`,
      select: "balance:value::text",
    });
    return BigInt(rows[0]?.balance || "0");
  };

  const E18 = 10n ** 18n;

  /** Fetch token metadata (customDecimals) with memoization */
  const decimalsCache = new Map();
  const getDecimals = async (tokenAddr) => {
    tokenAddr = tokenAddr.toLowerCase();
    if (decimalsCache.has(tokenAddr)) return decimalsCache.get(tokenAddr);
    const rows = await cirrusGet(`/BlockApps-Token`, {
      address: `eq.${tokenAddr}`,
      select: "customDecimals",
      limit: 1,
    });
    const dec = rows[0]?.customDecimals ? Number(rows[0].customDecimals) : 18;
    decimalsCache.set(tokenAddr, dec);
    return dec;
  };

  /* ---------- STEP 1: ensure liquidity ---------- */
  const minLiquidity = 10000n * E18;
  const lpBal = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
  if (lpBal < minLiquidity) {
    const topUp = minLiquidity - lpBal;
    console.log(`Depositing ${topUp / E18} USDST liquidity…`);
    await send(ADMIN_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", {
        spender: cfg.LIQUIDITY_POOL,
        value: topUp.toString(),
      }),
      buildCall("LendingPool", cfg.LENDING_POOL, "depositLiquidity", {
        amount: topUp.toString(),
      }),
    ]);
  }

  /* ---------- baseline oracle prices ---------- */
  console.log("Resetting oracle prices (GOLD=$2000, SILV=$25, USDST=$1)…");
  await send(ADMIN_TOKEN, [
    buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", {
      asset: cfg.GOLDST,
      price: (2000n * E18).toString(),
    }),
    buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", {
      asset: cfg.SILVST,
      price: (25n * E18).toString(),
    }),
    buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", {
      asset: cfg.USDST,
      price: E18.toString(), // $1
    }),
  ]);

  /* ---------- STEP 2: create healthy loans ---------- */
  console.log("Creating multi-collateral loans for borrowers…");
  for (const jwt of BORROWER_TOKENS) {
    // derive address of borrower
    const { data } = await axios.get(`${BASE}/key`, { headers: headers(jwt) });
    const addr = data.address.replace(/^0x/, "").toLowerCase();

    // ---------- ensure borrower owns required collateral ----------
    const ensureToken = async (tokenAddr, tokensNeeded) => {
      const dec = await getDecimals(tokenAddr);
      const unit = 10n ** BigInt(dec);
      const rawNeeded = BigInt(tokensNeeded) * unit;
      const bal = await getBalance(tokenAddr, addr);
      if (bal < rawNeeded) {
        const missing = rawNeeded - bal;
        const human = Number(missing) / Number(unit);
        console.log(`    – topping up ${human} tokens of ${tokenAddr} to borrower ${addr}`);
        await send(ADMIN_TOKEN, buildCall("Token", tokenAddr, "transfer", {
          to: addr,
          value: missing.toString(),
        }));
      }
    };

    await ensureToken(cfg.GOLDST, 1n); // 1 GOLD token
    await ensureToken(cfg.SILVST, 50n); // 50 SILV tokens

    // compute raw amounts for approve & supply based on decimals
    const goldUnit = 10n ** BigInt(await getDecimals(cfg.GOLDST));
    const silvUnit = 10n ** BigInt(await getDecimals(cfg.SILVST));

    const txs = [
      // approve + supply GOLDST
      buildCall("Token", cfg.GOLDST, "approve", {
        spender: cfg.COLLATERAL_VAULT,
        value: (1n * goldUnit).toString(),
      }),
      buildCall("LendingPool", cfg.LENDING_POOL, "supplyCollateral", {
        asset: cfg.GOLDST,
        amount: (1n * goldUnit).toString(),
      }),
      // approve + supply SILVST
      buildCall("Token", cfg.SILVST, "approve", {
        spender: cfg.COLLATERAL_VAULT,
        value: (50n * silvUnit).toString(),
      }),
      buildCall("LendingPool", cfg.LENDING_POOL, "supplyCollateral", {
        asset: cfg.SILVST,
        amount: (50n * silvUnit).toString(),
      }),
      // borrow 2 500 USDST
      buildCall("LendingPool", cfg.LENDING_POOL, "borrow", {
        amount: (2500n * E18).toString(),
      }),
    ];

    await send(jwt, txs);
    console.log(`  ✓ Borrower ${addr} loan created`);
  }

  /* ---------- STEP 3: crash prices to make loans unhealthy ---------- */
  console.log("Crashing GOLD & SILV prices to make loans liquidatable…");
  await send(ADMIN_TOKEN, [
    buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", {
      asset: cfg.GOLDST,
      price: (800n * E18).toString(), // $800
    }),
    buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", {
      asset: cfg.SILVST,
      price: (10n * E18).toString(), // $10
    }),
  ]);

  console.log("All multi-collateral loans should now have health-factor < 1.");
})(); 