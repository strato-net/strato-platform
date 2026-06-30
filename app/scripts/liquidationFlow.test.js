// Integration test for lending lifecycle with GOLDST liquidation
// Run via: node scripts/liquidationFlow.test.js

const axios = require("axios");
require("dotenv").config();

(async () => {
  console.log("=== Starting liquidation integration test ===");
  /* ---------- env & config checks ---------- */
  const nodeEnv = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!nodeEnv) {
    console.error("Set STRATO_NODE_URL or NODE_URL in env");
    process.exit(1);
  }

  const required = [
    "ADMIN_TOKEN",
    "USER_TOKEN",
    // other addresses resolved with fallback below
  ];
  required.forEach((k) => {
    if (!process.env[k]) {
      console.error(`Missing env var ${k}`);
      process.exit(1);
    }
  });

  const ROOT = nodeEnv.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const USER_TOKEN = process.env.USER_TOKEN;
  // derive admin address (liquidator)
  let ADMIN_ADDRESS = process.env.ADMIN_ADDRESS;
  if (!ADMIN_ADDRESS) {
    try {
      const keyUrl = `${BASE}/key`;
      const { data } = await axios.get(keyUrl, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
      ADMIN_ADDRESS = data.address?.replace(/^0x/, "");
    } catch {}
  }
  if (!ADMIN_ADDRESS) {
    console.error("Could not determine ADMIN_ADDRESS; set env var ADMIN_ADDRESS");
    process.exit(1);
  }

  // derive user address
  let USER_ADDRESS = process.env.USER_ADDRESS;
  if (!USER_ADDRESS) {
    console.log("Attempting to fetch address via /key endpoint …");
    try {
      const keyUrl = `${BASE}/key`;
      const { data } = await axios.get(keyUrl, { headers: { Authorization: `Bearer ${USER_TOKEN}` } });
      USER_ADDRESS = data.address?.replace(/^0x/, "");
    } catch (e) {}
    if (!USER_ADDRESS) {
      console.error("Could not determine USER_ADDRESS; set env var USER_ADDRESS");
      process.exit(1);
    }
  }

  USER_ADDRESS = USER_ADDRESS.replace(/^0x/, "").toLowerCase();

  const cfg = {
    LENDING_POOL: process.env.LENDING_POOL_ADDR || process.env.LENDING_POOL,
    LIQUIDITY_POOL: process.env.LIQUIDITY_POOL_ADDR || process.env.LIQUIDITY_POOL,
    COLLATERAL_VAULT: process.env.COLLATERAL_VAULT_ADDR || process.env.COLLATERAL_VAULT,
    PRICE_ORACLE: process.env.PRICE_ORACLE_ADDR || process.env.PRICE_ORACLE,
    USDST: process.env.USDST_ADDR || process.env.USDST,
    GOLDST: process.env.GOLDST_ADDR || process.env.GOLDST,
    POOL_CONFIGURATOR: process.env.POOL_CONFIGURATOR_ADDR || process.env.POOL_CONFIGURATOR,
  };

  // Validate that all contract addresses are present. Fail fast with a helpful message if any are missing.
  Object.entries(cfg).forEach(([key, value]) => {
    if (!value) {
      console.error(`Missing contract address for ${key}. Set ${key}_ADDR (or legacy ${key}) in the environment before running the test.`);
      process.exit(1);
    }
  });

  const headers = (tok) => ({ Authorization: `Bearer ${tok}`, "Content-Type": "application/json" });
  const buildCall = (name, addr, method, args = {}) => ({
    payload: {
      contractName: name,
      contractAddress: addr,
      method,
      args,
    },
    type: "FUNCTION",
  });

  // --- Cirrus read helpers (pure read, no transactions) ---
  const CIRRUS_BASE = ROOT.includes("/strato") ? ROOT.split("/strato")[0] : ROOT;
  const cirrusGet = async (path, params) => {
    const url = `${CIRRUS_BASE}/cirrus/search${path}`;
    const { data } = await axios.get(url, { headers: headers(ADMIN_TOKEN), params });
    return data;
  };

  // Read ERC-20 balance via BlockApps-Token-_balances view
  const getBalance = async (tokenAddr, holderAddr) => {
    const token = tokenAddr.replace(/^0x/, "").toLowerCase();
    const holder = holderAddr.replace(/^0x/, "").toLowerCase();
    const data = await cirrusGet("/BlockApps-Token-_balances", {
      key: `eq.${holder}`,
      address: `eq.${token}`,
      select: "balance:value::text",
    });
    const balStr = data[0]?.balance || "0";
    return BigInt(balStr);
  };

  const E18 = 10n ** 18n;
  const fmt = (weiBigInt) => {
    const whole = weiBigInt / E18;
    const frac = (weiBigInt % E18).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  };

  const assertDelta = (before, after, expected, label, tolerance = 0n) => {
    const diff = after - before;
    const lower = expected - tolerance;
    const upper = expected + tolerance;
    if (diff < lower || diff > upper) {
      throw new Error(`${label} – expected Δ ${fmt(expected)} ± ${fmt(tolerance)} but got ${fmt(diff)}`);
    }
    console.log(`      ↳ ${label}: Δ ${fmt(diff)}`);
  };

  const sendTx = async (token, txs) => {
    const body = { txs: Array.isArray(txs) ? txs : [txs], txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    try {
      const { data } = await axios.post(txEndpoint, body, { headers: headers(token) });
      if (data[0]?.status !== "Success") {
        console.error("Strato returned failure:", JSON.stringify(data, null, 2));
        throw new Error("Tx status not Success");
      }
    } catch (err) {
      if (err.response) {
        console.error("HTTP", err.response.status, err.response.statusText);
        if (typeof err.response.data === "string") {
          console.error(err.response.data);
        } else {
          console.error("⇡ Strato payload:", JSON.stringify(err.response.data, null, 2));
        }
      }
      throw err;
    }
  };

  // --- Borrower loan helper (principal + interest) via Cirrus ---
  const getUserDebt = async () => {
    try {
      const rows = await cirrusGet("/BlockApps-LendingPool-userLoan", {
        address: `eq.${cfg.LENDING_POOL.toLowerCase()}`,
        key: `eq.${USER_ADDRESS}`,
        select: "*",
      });
      if (!Array.isArray(rows) || rows.length === 0) return 0n;
      const row = rows[0] || {};
      let pStr = row.principalBalance ?? row.principalbalance ?? row.principal_balance;
      let iStr = row.interestOwed ?? row.interestowed ?? row.interest_owed;
      if (pStr === undefined || iStr === undefined) {
        const valObj = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        if (valObj) {
          pStr = pStr ?? valObj.principalBalance ?? valObj.principalbalance;
          iStr = iStr ?? valObj.interestOwed ?? valObj.interestowed;
        }
      }
      if (!pStr) pStr = "0";
      if (!iStr) iStr = "0";
      return BigInt(pStr) + BigInt(iStr);
    } catch {
      return 0n;
    }
  };

  const getHealthFactor = async () => {
    try {
      const body = {
        txs: [
          {
            payload: {
              contractName: "LendingPool",
              contractAddress: cfg.LENDING_POOL,
              method: "getHealthFactor",
              args: { user: USER_ADDRESS },
            },
            type: "FUNCTION",
          },
        ],
        txParams: { gasLimit: 150000, gasPrice: 1 },
      };
      const { data } = await axios.post(txEndpoint, body, { headers: headers(ADMIN_TOKEN) });
      if (data[0]?.status !== "Success") throw new Error("HF call failed");
      return BigInt(data[0].data.contents[0] || 0);
    } catch {
      return 0n;
    }
  };

  try {
    console.log("1) Admin deposits 500 USDST");

    const lpUsdBefore = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);

    await sendTx(ADMIN_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", { spender: cfg.LIQUIDITY_POOL, value: "500000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "depositLiquidity", { amount: "500000000000000000000" }),
    ]);

    const lpUsdAfter = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
    assertDelta(lpUsdBefore, lpUsdAfter, 500n * E18, "LiquidityPool USDST balance");
    console.log("   ✓ liquidity deposited\n");

    console.log("2) User supplies 1 GOLDST collateral");

    const cvGoldBefore = await getBalance(cfg.GOLDST, cfg.COLLATERAL_VAULT);

    await sendTx(USER_TOKEN, [
      buildCall("Token", cfg.GOLDST, "approve", { spender: cfg.COLLATERAL_VAULT, value: "1000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "supplyCollateral", { asset: cfg.GOLDST, amount: "1000000000000000000" }),
    ]);

    const cvGoldAfter = await getBalance(cfg.GOLDST, cfg.COLLATERAL_VAULT);
    assertDelta(cvGoldBefore, cvGoldAfter, 1n * E18, "CollateralVault GOLDST balance");
    console.log("   ✓ collateral supplied\n");

    console.log("2b) Set initial GOLD price to $2000");
    await sendTx(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.GOLDST, price: "2000000000000000000000" }));
    // Ensure USDST oracle price is $1
    await sendTx(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.USDST, price: "1000000000000000000" }));
    console.log("   ✓ price initialized\n");

    // 2c) Ensure GOLD asset configuration (incl. liquidation bonus) is set
    let currBonus = 0n;
    try {
      const bonusCheck = await cirrusGet("/BlockApps-LendingPool-assetLiquidationBonus", {
        address: `eq.${cfg.LENDING_POOL.toLowerCase()}`,
        key: `eq.${cfg.GOLDST.toLowerCase()}`,
        select: "value,value_fkey,bonus",
      });
      const rowB = bonusCheck[0] || {};
      let bonusStr = rowB.bonus ?? rowB.value_fkey ?? rowB.value;
      if (!bonusStr) bonusStr = "0";
      let bonusNum = BigInt(bonusStr);
      if (bonusNum < 10000n) bonusNum *= 100n; // upscale if stored as percent (e.g., 105 -> 10500)
      currBonus = bonusNum;
    } catch (e) {
      console.log("      ↳ Cirrus view for liquidation bonus unavailable – will configure asset params");
    }
    if (currBonus < 10000n) {
      console.log("2c) Configure GOLD collateral parameters");
      await sendTx(ADMIN_TOKEN, buildCall("PoolConfigurator", cfg.POOL_CONFIGURATOR, "configureAsset", {
        asset: cfg.GOLDST,
        ltv: "7500",
        liquidationThreshold: "8000",
        liquidationBonus: "10500",
        interestRate: "500",
        reserveFactor: "1000",
      }));
      console.log("   ✓ asset configured\n");
    }

    console.log("3) User borrows 1000 USDST");

    const lpUsdBeforeBorrow = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
    const userUsdBeforeBorrow = await getBalance(cfg.USDST, USER_ADDRESS);

    await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: "1000000000000000000000" }));

    const lpUsdAfterBorrow = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
    const userUsdAfterBorrow = await getBalance(cfg.USDST, USER_ADDRESS);
    assertDelta(lpUsdBeforeBorrow, lpUsdAfterBorrow, -1000n * E18, "LiquidityPool USDST balance (after borrow)");
    const TOLERANCE = 1n * 10n ** 17n; // 0.1 USDST
    assertDelta(userUsdBeforeBorrow, userUsdAfterBorrow, 1000n * E18, "User USDST balance (after borrow)", TOLERANCE);
    console.log("   ✓ borrow executed\n");

    console.log("4) Crash GOLD price to $1000");
    await sendTx(ADMIN_TOKEN, buildCall("PriceOracle", cfg.PRICE_ORACLE, "setAssetPrice", { asset: cfg.GOLDST, price: "1000000000000000000000" }));
    console.log("   ✓ price updated\n");

    console.log("5) Liquidate position (dynamic repay considering bonus)");

    const lpUsdBeforeLiq = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
    const cvGoldBeforeLiq = await getBalance(cfg.GOLDST, cfg.COLLATERAL_VAULT);

    // Track liquidator balances to verify profitability
    const adminGoldBefore = await getBalance(cfg.GOLDST, ADMIN_ADDRESS);
    const adminUsdBefore = await getBalance(cfg.USDST, ADMIN_ADDRESS);

    // Fetch liquidation bonus for GOLDST; tolerate view unavailability
    let bonusBP = 10500n;
    try {
      const bonusArr = await cirrusGet("/BlockApps-LendingPool-assetLiquidationBonus", {
        address: `eq.${cfg.LENDING_POOL.toLowerCase()}`,
        key: `eq.${cfg.GOLDST.toLowerCase()}`,
        select: "value,value_fkey,bonus",
      });
      const rowL = bonusArr[0] || {};
      let bStr = rowL.bonus ?? rowL.value_fkey ?? rowL.value;
      if (!bStr) bStr = "10500";
      let bNum = BigInt(bStr);
      if (bNum < 10000n) bNum *= 100n;
      bonusBP = bNum;
    } catch {
      console.log("      ↳ Cirrus bonus view unavailable during liquidation – defaulting to 10500");
    }

    const PRICE_COLL = 1000n * E18; // as set earlier
    const PRICE_DEBT = 1n * E18;   // assume USDST = $1

    // Calculate theoretical repay to seize all collateral
    let repayAll = (cvGoldBeforeLiq * PRICE_COLL * 10000n) / (bonusBP * PRICE_DEBT);
    repayAll = repayAll + 1n; // buffer

    // Respect 50% cap when HF >= 0.95
    const HF95 = 95n * 10n ** 16n;
    const hfNow = await getHealthFactor();
    const totalDebt = await getUserDebt();
    let maxRepayAllowed = totalDebt;
    if (hfNow >= HF95) {
      maxRepayAllowed = totalDebt / 2n;
    }

    let repayAmt = repayAll > maxRepayAllowed ? maxRepayAllowed : repayAll;
    if (repayAmt === 0n) repayAmt = 1n;

    await sendTx(ADMIN_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", { spender: cfg.LIQUIDITY_POOL, value: repayAmt.toString() }),
      buildCall("LendingPool", cfg.LENDING_POOL, "liquidationCall", { collateralAsset: cfg.GOLDST, borrower: USER_ADDRESS, debtToCover: repayAmt.toString() }),
    ]);

    const lpUsdAfterLiq = await getBalance(cfg.USDST, cfg.LIQUIDITY_POOL);
    const cvGoldAfterLiq = await getBalance(cfg.GOLDST, cfg.COLLATERAL_VAULT);
    const adminGoldAfter = await getBalance(cfg.GOLDST, ADMIN_ADDRESS);
    const adminUsdAfter = await getBalance(cfg.USDST, ADMIN_ADDRESS);

    assertDelta(lpUsdBeforeLiq, lpUsdAfterLiq, repayAmt, "LiquidityPool USDST balance (after liquidation)");

    const goldDiff = cvGoldAfterLiq - cvGoldBeforeLiq;
    const TOL_GOLD = 1n * 10n ** 15n; // tolerance 0.001 GOLD
    if (goldDiff > TOL_GOLD) {
      throw new Error(`Collateral did not decrease as expected; Δ ${fmt(goldDiff)}`);
    }
    console.log(`      ↳ CollateralVault GOLDST balance (after liquidation): Δ ${fmt(goldDiff)}`);

    // Calculate liquidator profitability
    const adminGoldDelta = adminGoldAfter - adminGoldBefore;
    const adminUsdDelta = adminUsdAfter - adminUsdBefore; // should be negative (spent)

    // Convert gold gained into USD terms using post-crash price
    const valueOfGoldGained = (adminGoldDelta * PRICE_COLL) / E18;
    const profitUsd = valueOfGoldGained + adminUsdDelta; // adminUsdDelta is negative when spending

    console.log(`      ↳ Liquidator GOLD gained: ${fmt(adminGoldDelta)} (~$${fmt(valueOfGoldGained)})`);
    console.log(`      ↳ Liquidator USD change: ${fmt(adminUsdDelta)}`);
    console.log(`      ↳ Net profit: $${fmt(profitUsd)}`);

    if (profitUsd <= 0n) {
      throw new Error("Liquidation was not profitable for the liquidator");
    }

    console.log("   ✓ liquidation profitable\n");

    console.log(`      ↳ Liquidator balances:`);
    console.log(`          GOLD before: ${fmt(adminGoldBefore)}  | after: ${fmt(adminGoldAfter)}`);
    console.log(`          USD  before: ${fmt(adminUsdBefore)}  | after: ${fmt(adminUsdAfter)}`);

    console.log("SUCCESS - full flow passed");
  } catch (err) {
    console.error("FAILED:", err.message || err);
    process.exit(1);
  }
})(); 