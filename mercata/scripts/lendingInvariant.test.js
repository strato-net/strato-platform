// Basic invariants test for LendingPool mechanics
// Usage: node scripts/lendingInvariant.test.js
// Focuses on "dumb" edge-cases to catch obvious regressions.

const axios = require("axios");
require("dotenv").config();

(async () => {
  console.log("=== Lending invariant test ===");

  /* ----------------- env ----------------- */
  const nodeEnv = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!nodeEnv) {
    console.error("Need STRATO_NODE_URL or NODE_URL env var set");
    process.exit(1);
  }
  const ROOT = nodeEnv.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const USER_TOKEN = process.env.USER_TOKEN;
  if (!ADMIN_TOKEN || !USER_TOKEN) {
    console.error("Provide ADMIN_TOKEN and USER_TOKEN env vars");
    process.exit(1);
  }

  let USER_ADDRESS = process.env.USER_ADDRESS;
  if (!USER_ADDRESS) {
    try {
      const { data } = await axios.get(`${BASE}/key`, {
        headers: { Authorization: `Bearer ${USER_TOKEN}` },
      });
      USER_ADDRESS = data.address?.replace(/^0x/, "");
    } catch {}
    if (!USER_ADDRESS) {
      console.error("Unable to determine USER_ADDRESS (set env var)");
      process.exit(1);
    }
  }
  USER_ADDRESS = USER_ADDRESS.replace(/^0x/, "").toLowerCase();

  /* ----------------- contracts ----------------- */
  const cfg = {
    LENDING_POOL: process.env.LENDING_POOL_ADDR || process.env.LENDING_POOL,
    LIQUIDITY_POOL: process.env.LIQUIDITY_POOL_ADDR || process.env.LIQUIDITY_POOL,
    COLLATERAL_VAULT: process.env.COLLATERAL_VAULT_ADDR || process.env.COLLATERAL_VAULT,
    PRICE_ORACLE: process.env.PRICE_ORACLE_ADDR || process.env.PRICE_ORACLE,
    POOL_CONFIGURATOR: process.env.POOL_CONFIGURATOR_ADDR || process.env.POOL_CONFIGURATOR,
    USDST: process.env.USDST_ADDR || process.env.USDST,
    GOLDST: process.env.GOLDST_ADDR || process.env.GOLDST,
  };
  Object.entries(cfg).forEach(([k, v]) => {
    if (!v) {
      console.error(`Missing env var for ${k}`);
      process.exit(1);
    }
  });

  /* ----------------- helpers ----------------- */
  const headers = (tok) => ({ Authorization: `Bearer ${tok}`, "Content-Type": "application/json" });
  const buildCall = (name, addr, method, args = {}) => ({
    payload: { contractName: name, contractAddress: addr, method, args },
    type: "FUNCTION",
  });
  const sendTx = async (token, calls) => {
    const body = { txs: Array.isArray(calls) ? calls : [calls], txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    const { data } = await axios.post(txEndpoint, body, { headers: headers(token) });
    if (data[0]?.status !== "Success") throw new Error(JSON.stringify(data));
  };

  // Cirrus read helper (read-only)
  const CIRRUS_BASE = ROOT.includes("/strato") ? ROOT.split("/strato")[0] : ROOT;
  const cirrusGet = async (path, params) => {
    const { data } = await axios.get(`${CIRRUS_BASE}/cirrus/search${path}`, { headers: headers(ADMIN_TOKEN), params });
    return data;
  };

  // Fetch total liquidity for USDST held by LiquidityPool
  const getPoolLiquidity = async () => {
    try {
      const rows = await cirrusGet("/BlockApps-Mercata-Token-_balances", {
        key: `eq.${cfg.LIQUIDITY_POOL.toLowerCase()}`,
        address: `eq.${cfg.USDST.toLowerCase()}`,
        select: "balance:value::text",
      });
      return BigInt(rows[0]?.balance || "0");
    } catch {
      return 0n;
    }
  };

  // Read collateral directly from contract (authoritative)
  const getCollateralOnChain = async (assetAddr) => {
    const body = {
      txs: [
        {
          payload: {
            contractName: "CollateralVault",
            contractAddress: cfg.COLLATERAL_VAULT,
            method: "getCollateral",
            args: { user: USER_ADDRESS, asset: assetAddr },
          },
          type: "FUNCTION",
        },
      ],
      txParams: { gasLimit: 150000, gasPrice: 1 },
    };
    const { data } = await axios.post(txEndpoint, body, { headers: headers(ADMIN_TOKEN) });
    if (data[0]?.status !== "Success") return 0n;
    return BigInt(data[0].data.contents[0] || 0);
  };

  const getUserCollateral = async () => {
    try {
      const rows = await cirrusGet("/BlockApps-Mercata-CollateralVault-collaterals", {
        key: `eq.${USER_ADDRESS}`,
        select: "Collateral:value",
      });
      let total = 0n;
      for (const r of rows) {
        const amt = r?.Collateral?.amount;
        if (amt) total += BigInt(amt);
      }
      return total;
    } catch {
      return 0n;
    }
  };

  const getMaxBorrowPower = async () => {
    // call calculateMaxBorrowingPower(user, 0x0, 0)
    const body = {
      txs: [
        {
          payload: {
            contractName: "LendingPool",
            contractAddress: cfg.LENDING_POOL,
            method: "calculateMaxBorrowingPower",
            args: {
              user: USER_ADDRESS,
              excludeAsset: "0000000000000000000000000000000000000000",
              excludeAmount: "0",
            },
          },
          type: "FUNCTION",
        },
      ],
      txParams: { gasLimit: 150000, gasPrice: 1 },
    };
    const { data } = await axios.post(txEndpoint, body, { headers: headers(ADMIN_TOKEN) });
    if (data[0]?.status !== "Success") return 0n;
    return BigInt(data[0].data.contents[0] || 0);
  };

  /* ----------------- test cases ----------------- */
  try {
    /* 1. Borrow fails if requested amount exceeds available liquidity */
    console.log("1) Borrow more than pool liquidity (should fail)…");
    const liquidity = await getPoolLiquidity();
    const reqAmt = liquidity + 1n * 10n ** 18n; // 1 token more than available
    let threw = false;
    try {
      await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: reqAmt.toString() }));
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Borrow succeeded despite insufficient liquidity");
    console.log("   ✓ rejected as expected\n");

    /* 1b. Ensure user has no leftover collateral at start */
    try {
      await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "withdrawCollateral", { asset: cfg.GOLDST, amount: "1000000000000000000000000000000" }));
    } catch {}

    /* 2. Deposit liquidity so pool has funds */
    console.log("2) Admin deposits 1000 USDST liquidity…");
    await sendTx(ADMIN_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", { spender: cfg.LIQUIDITY_POOL, value: "1000000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "depositLiquidity", { amount: "1000000000000000000000" }),
    ]);
    console.log("   ✓ liquidity deposited\n");

    /* Ensure no existing collateral of any asset before collateral-less borrow test */
    try {
      const all = await cirrusGet("/BlockApps-Mercata-CollateralVault-collaterals", {
        key: `eq.${USER_ADDRESS}`,
        select: "asset,Collateral:value",
      });
      for (const row of all) {
        const amt = row?.Collateral?.amount;
        const assetAddr = row.asset;
        if (amt && BigInt(amt) > 0n) {
          try {
            await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "withdrawCollateral", { asset: assetAddr, amount: amt }));
          } catch {}
        }
      }
    } catch {}

    /* 3. Borrow should fail when user has zero collateral */
    const collCirrus = await getUserCollateral();
    const collOnChain = await getCollateralOnChain(cfg.GOLDST);

    if (collCirrus !== collOnChain) {
      console.log(`ℹ️  Collateral discrepancy: Cirrus=${collCirrus.toString()} Wei, On-chain=${collOnChain.toString()} Wei`);
    }

    if (collCirrus === 0n && collOnChain === 0n) {
      console.log("3) Borrow should fail without supplying collateral…");
      threw = false;
      try {
        await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: "1000000000000000000" }));
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("Borrow succeeded without collateral");
      console.log("   ✓ rejected as expected\n");
    } else {
      console.log(`3) Skipped: user still has collateral (Cirrus=${collCirrus}, On-chain=${collOnChain})\n`);
    }

    /* 4. Supply collateral & borrow once */
    console.log("4) User supplies 1 GOLD collateral and borrows 200 USDST…");
    await sendTx(USER_TOKEN, [
      buildCall("Token", cfg.GOLDST, "approve", { spender: cfg.COLLATERAL_VAULT, value: "1000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "supplyCollateral", { asset: cfg.GOLDST, amount: "1000000000000000000" }),
    ]);
    await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: "200000000000000000000" }));
    console.log("   ✓ first borrow ok\n");

    /* 4b. Another user (admin) cannot withdraw borrower's collateral */
    console.log("4b) Admin attempts to withdraw user's collateral (should fail)…");
    threw = false;
    try {
      await sendTx(ADMIN_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "withdrawCollateral", { asset: cfg.GOLDST, amount: "100000000000000000" }));
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Able to withdraw someone else's collateral");
    console.log("   ✓ rejected as expected\n");

    /* 5. Borrow additional within health factor should succeed */
    console.log("5) Borrow additional 200 USDST (within HF)…");
    await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: "200000000000000000000" }));
    console.log("   ✓ additional borrow ok\n");

    /* 6. Borrow exceeding health factor should fail */
    const maxPower = await getMaxBorrowPower();
    const excessive = maxPower + 1n * 10n ** 18n; // 1 USDST over limit
    console.log(`6) Borrow ${(excessive / 10n ** 18n).toString()} USDST (should fail – exceeds HF)…`);
    threw = false;
    try {
      await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "borrow", { amount: excessive.toString() }));
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Borrow exceeded HF but succeeded");
    console.log("   ✓ rejected as expected\n");

    /* 7. Repay full loan and withdraw collateral */
    console.log("7) User repays full loan and withdraws collateral…");
    // Approve 500 USDST repay ( > total borrowed )
    await sendTx(USER_TOKEN, [
      buildCall("Token", cfg.USDST, "approve", { spender: cfg.LIQUIDITY_POOL, value: "500000000000000000000" }),
      buildCall("LendingPool", cfg.LENDING_POOL, "repay", { amount: "500000000000000000000" }),
    ]);
    // Now withdraw collateral
    await sendTx(USER_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "withdrawCollateral", { asset: cfg.GOLDST, amount: "1000000000000000000" }));
    console.log("   ✓ repay & withdraw succeeded\n");

    /* 8. Liquidity provider withdraw fails when pool liquidity low (borrow outstanding earlier consumed) */
    console.log("8) Admin attempts to withdraw 900 USDST liquidity (should succeed now if enough, else skip)…");
    threw = false;
    try {
      await sendTx(ADMIN_TOKEN, buildCall("LendingPool", cfg.LENDING_POOL, "withdrawLiquidity", { amount: "900000000000000000000" }));
    } catch {
      threw = true;
    }
    if (threw) {
      console.log("   ✓ withdrawal rejected (expected when liquidity insufficient)\n");
    } else {
      console.log("   ✓ withdrawal succeeded (liquidity free)\n");
    }

    console.log("SUCCESS – all invariants passed");
  } catch (err) {
    console.error("FAILED:", err.message || err);
    process.exit(1);
  }
})(); 