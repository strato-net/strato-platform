/*
  Script: populateLiquidatableLoans.js
  Purpose: Quickly create one or more unhealthy (liquidatable) loans so the front-end Liquidations UI has data to work with.

  Usage:
    ADMIN_TOKEN=<adminJwt> STRATO_NODE_URL=<node> \
    BORROWER_TOKENS="token1,token2" \
    node scripts/populateLiquidatableLoans.js

  Env vars:
    – STRATO_NODE_URL  or NODE_URL  : Strato base URL
    – ADMIN_TOKEN                     : JWT for an admin wallet (has GOLD & USDST)
    – BORROWER_TOKENS (csv)          : JWTs for one or more borrower wallets
    – Optional contract addresses    : LENDING_POOL, LIQUIDITY_POOL, COLLATERAL_VAULT, PRICE_ORACLE, USDST, GOLDST

  What it does:
    1. Ensures LiquidityPool has ≥ 5 000 USDST.
    2. For each borrower wallet given:
        a. Supplies 1 GOLDST as collateral
        b. Sets GOLD price to $2 000
        c. Borrows 1 500 USDST (HF healthy)
    3. After all loans opened, crashes GOLD price to $1 000 → all loans become unhealthy (HF < 1).

  The script prints each borrower address so you can paste them into the UI.
*/

const axios = require("axios");
require("dotenv").config();

(async () => {
  const node = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!node) throw new Error("Set STRATO_NODE_URL or NODE_URL env var");
  const ROOT = node.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN required");

  const BORROWER_TOKENS = (process.env.BORROWER_TOKENS || "").split(/\s*,\s*/).filter(Boolean);
  if (BORROWER_TOKENS.length === 0) throw new Error("Provide BORROWER_TOKENS (comma-sep JWTs)");

  /* ---------- contract addresses ---------- */
  const cfg = {
    LENDING_POOL: process.env.LENDING_POOL,
    LIQUIDITY_POOL: process.env.LIQUIDITY_POOL,
    COLLATERAL_VAULT: process.env.COLLATERAL_VAULT,
    PRICE_ORACLE: process.env.PRICE_ORACLE,
    USDST: process.env.USDST,
    GOLDST: process.env.GOLDST,
  };
  Object.entries(cfg).forEach(([k, v]) => {
    if (!v) throw new Error(`Missing env var ${k}`);
  });

  /* ---------- helpers ---------- */
  const headers = (tok) => ({ Authorization: `Bearer ${tok}`, "Content-Type": "application/json" });
  const buildCall = (name, addr, method, args = {}) => ({ payload: { contractName: name, contractAddress: addr, method, args }, type: "FUNCTION" });
  const send = async (tok, txs) => {
    const body = { txs: Array.isArray(txs) ? txs : [txs], txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    const { data } = await axios.post(txEndpoint, body, { headers: headers(tok) });
    if (data[0]?.status !== "Success") throw new Error(JSON.stringify(data));
  };
  const cirrusGet = async (path, params) => {
    const url = `${ROOT}/cirrus/search${path}`;
    const { data } = await axios.get(url, { headers: headers(ADMIN_TOKEN), params });
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

  /* ---------- STEP 1: ensure liquidity ---------- */
  const lpBal = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
  if (lpBal < 5000n * E18) {
    const topUp = 5000n * E18 - lpBal;
    console.log(`Depositing ${topUp / E18} USDST liquidity…`);
    await send(ADMIN_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", { spender: cfg.LIQUIDITY_POOL, value: topUp.toString() }),
      buildCall("LendingPool", cfg.LENDING_POOL, "depositLiquidity", { amount: topUp.toString() }),
    ]);
  }

  /* ---------- baseline oracle prices ---------- */
  console.log("Resetting oracle prices (GOLD=$2000, USDST=$1)…");
  await send(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.GOLDST, price: "2000000000000000000000" }));
  await send(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.USDST,  price: "1000000000000000000" }));

  /* ---------- STEP 2: create healthy loans ---------- */
  console.log("Creating loans for borrowers…");
  for (const jwt of BORROWER_TOKENS) {
    // derive address
    const { data } = await axios.get(`${BASE}/key`, { headers: headers(jwt) });
    const addr = data.address.replace(/^0x/, "").toLowerCase();

    // supply 1 GOLD
    await send(jwt, [
      buildCall("Token", cfg.GOLDST, "approve", { spender: cfg.COLLATERAL_VAULT, value: "1000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "supplyCollateral", { asset: cfg.GOLDST, amount: "1000000000000000000" }),
    ]);
    // borrow 1500 USDST
    await send(jwt, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: "1500000000000000000000" }));

    console.log(`  ✓ Borrower ${addr} loan created`);
  }

  /* ---------- STEP 3: crash price to make loans unhealthy ---------- */
  console.log("Crashing GOLD price to $1000 to make loans liquidatable…");
  await send(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.GOLDST, price: "1000000000000000000000" }));
  console.log("All loans should now have health-factor < 1. Ready for UI testing.");
})(); 