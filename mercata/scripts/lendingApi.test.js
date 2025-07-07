/*
 * Quick end-to-end sanity test for the Lending REST API.
 *
 * Required env vars:
 *   API_BASE_URL  – backend URL (default http://localhost:4000)
 *   USER_TOKEN    – JWT for normal user (fallback USER_JWT)
 *   COLLATERAL_ASSET or GOLDST_ADDR or GOLDST – address to pledge as collateral
 *   USDST or USDST_ADDR or USDST_TOKEN        – stablecoin to borrow / repay
 *
 * Example:
 *   export API_BASE_URL="http://localhost:4000"
 *   export USER_TOKEN="<jwt>"
 *   export GOLDST_ADDR="cdc93d30182125e05eec985b631c7c61b3f63ff0"
 *   export USDST_ADDR="937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
 *   node scripts/lendingApi.test.js
 */

require("dotenv").config();
const axios = require("axios");

/* ---------- env ---------- */
const BASE = (process.env.API_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const USER_TOKEN = process.env.USER_TOKEN || process.env.USER_JWT;
const COLLATERAL_ASSET = (process.env.COLLATERAL_ASSET || process.env.GOLDST_ADDR || process.env.GOLDST || "").toLowerCase();
const USDST = (process.env.USDST || process.env.USDST_ADDR || process.env.USDST_TOKEN || "").toLowerCase();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!USER_TOKEN || !COLLATERAL_ASSET || !USDST) {
  console.error("Missing env vars. Need USER_TOKEN, COLLATERAL_ASSET, USDST, (optional API_BASE_URL)");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${USER_TOKEN}` };
const E18 = 10n ** 18n;
const toWei = (n) => (BigInt(Math.round(n * 1e6)) * E18 / 1000000n).toString();
const pretty = (x) => {
  try {
    const b = BigInt(x);
    return `${b / E18}.${(b % E18).toString().padStart(18, "0").replace(/0+$/, "")}`;
  } catch {
    return x;
  }
};

/* ---------- helpers ---------- */
const post = (path, body) => axios.post(`${BASE}${path}`, body, { headers });
const get  = (path)       => axios.get(`${BASE}${path}`,      { headers });

const strip0x = (s) => s.replace(/^0x/, "").toLowerCase();

const getPool = async () => { const { data } = await get('/lend'); return data; };

(async () => {
  try {
    console.log("\n=== Lending REST-API sanity check ===\n");

    /* 0. Ensure at least 500 USDST liquidity so borrow succeeds */
    if (ADMIN_TOKEN) {
      const poolData = await getPool();
      const liqArr = poolData.liquidityPool?.totalLiquidity || [];
      const usdRow = liqArr.find(r => strip0x(r.asset) === strip0x(USDST));
      const current = BigInt(usdRow?.amount || 0);
      if (current < 500n * E18) {
        console.log(`Admin depositing liquidity (had ${current / E18} USDST)…`);
        await axios.post(`${BASE}/lend/depositLiquidity`,
          { asset: USDST, amount: toWei(1000) },
          { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
        );
        console.log('✓ liquidity deposited\n');
      }
    }

    /* 1. depositableTokens */
    const { data: tokens } = await get("/lend/depositableTokens");
    const collInfo = tokens.find((t) => strip0x(t.address) === strip0x(COLLATERAL_ASSET));
    if (!collInfo) throw new Error(`Collateral asset ${COLLATERAL_ASSET} not eligible`);
    console.log(`Collateral ${collInfo._symbol} OK (ratio ${(collInfo.collateralRatio/100).toFixed(2)}%)\n`);

    /* 2. supply collateral */
    console.log("Supplying 1 token collateral…");
    await post("/lend/supplyCollateral", { asset: COLLATERAL_ASSET, amount: toWei(1) });
    console.log("✓ supplyCollateral posted\n");

    /* 3. borrow */
    console.log("Borrowing 20 USDST…");
    await post("/lend/borrow", { amount: toWei(20) });
    console.log("✓ borrow posted\n");

    /* 4. loans */
    const { data: loans } = await get("/lend/loans");
    if (!loans?.length) throw new Error("/lend/loans empty after borrow");
    const l = loans[0].loan || loans[0];
    console.table({ principal: pretty(l.amount), interest: pretty(l.interest||0), healthFactor: l.healthFactor });

    /* 5. repay */
    console.log("Repaying 5 USDST…");
    await post("/lend/repay", { loanId: loans[0].key || loans[0].id || "0", asset: USDST, amount: toWei(5) });
    console.log("✓ repay posted\n");

    /* 6. withdraw collateral */
    console.log("Withdrawing 0.3 collateral…");
    await post("/lend/withdrawCollateral", { asset: COLLATERAL_ASSET, amount: toWei(0.3) });
    console.log("✓ withdrawCollateral posted\n");

    console.log("\nAll API actions posted successfully ✔️\n");
  } catch (err) {
    console.error("\n❌ Test failed:", err.response?.data || err.message || err);
    process.exit(1);
  }
})(); 