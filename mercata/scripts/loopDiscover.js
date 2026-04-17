// Loop discovery: enumerate every (asset, pool) combo the user can leverage on.
// Prints a human table and writes /tmp/loop_discovery.json for loopSweep.js.
//
// Usage: OAUTH_USERNAME=x OAUTH_PASSWORD=y node scripts/loopDiscover.js
// Requires: mercata/backend running at localhost:3001 and .env with NODE_URL + OAUTH creds.

const path = require("path");
module.paths.unshift(path.resolve(__dirname, "../backend/node_modules"));
const axios = require("axios");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../backend/.env") });

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";
const NODE_URL = (process.env.NODE_URL || "").replace(/\/+$/, "");
const CIRRUS = `${NODE_URL}/cirrus/search`;
const STRATO = `${NODE_URL}/strato/v2.3`;
const USDST = (process.env.USDST_ADDRESS || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010").toLowerCase();
const POOL_FACTORY = (process.env.POOL_FACTORY || "000000000000000000000000000000000000100a").toLowerCase();

const E18 = 10n ** 18n;
const fmt = (w) => {
  const x = BigInt(w);
  const whole = x / E18;
  const frac = ((x < 0n ? -x : x) % E18).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
};

async function getToken() {
  const { data: disco } = await axios.get(process.env.OAUTH_DISCOVERY_URL);
  const { data } = await axios.post(
    disco.token_endpoint,
    new URLSearchParams({
      grant_type: "password",
      client_id: process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      username: process.env.OAUTH_USERNAME,
      password: process.env.OAUTH_PASSWORD,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  return data.access_token;
}

async function cirrusGet(token, table, params) {
  const { data } = await axios.get(`${CIRRUS}/${table}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return data;
}

async function getUserAddress(token) {
  const { data } = await axios.get(`${STRATO}/key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (data.address || data).replace(/^0x/, "").toLowerCase();
}

async function getBalance(token, tokenAddr, user) {
  const rows = await cirrusGet(token, "BlockApps-Token-_balances", {
    address: `eq.${tokenAddr.toLowerCase()}`,
    key: `eq.${user}`,
    select: "value::text",
  });
  return BigInt(rows?.[0]?.value || "0");
}

// Find CP or 2-coin stable pool via the Pool table.
async function findPairPool(token, usdst, asset) {
  // PostgREST or= syntax sometimes rejects bare hex strings; fetch all matching by tokenA
  // and filter in JS. Trade: 2 round-trips instead of 1, but reliable.
  const [ra, rb] = await Promise.all([
    cirrusGet(token, "BlockApps-Pool", {
      poolFactory: `eq.${POOL_FACTORY}`, locked: "eq.false",
      tokenA: `eq.${usdst}`, tokenB: `eq.${asset}`,
      select: "address,tokenA,tokenB,isStable,swapFeeRate,tokenABalance::text,tokenBBalance::text",
    }),
    cirrusGet(token, "BlockApps-Pool", {
      poolFactory: `eq.${POOL_FACTORY}`, locked: "eq.false",
      tokenA: `eq.${asset}`, tokenB: `eq.${usdst}`,
      select: "address,tokenA,tokenB,isStable,swapFeeRate,tokenABalance::text,tokenBBalance::text",
    }),
  ]);
  const rows = [...(ra || []), ...(rb || [])];
  if (rows.length === 0) return null;
  // Pick deepest USDST-liquidity match
  rows.sort((a, b) => {
    const la = BigInt(a.tokenA.toLowerCase() === usdst ? a.tokenABalance : a.tokenBBalance);
    const lb = BigInt(b.tokenA.toLowerCase() === usdst ? b.tokenABalance : b.tokenBBalance);
    return lb > la ? 1 : lb < la ? -1 : 0;
  });
  const p = rows[0];
  const isAToB = p.tokenA.toLowerCase() === usdst;
  return {
    poolAddress: p.address.toLowerCase(),
    poolType: p.isStable ? 1 : 0,
    coinI: isAToB ? 0 : 1,
    coinJ: isAToB ? 1 : 0,
    usdstLiquidity: isAToB ? p.tokenABalance : p.tokenBBalance,
    assetLiquidity: isAToB ? p.tokenBBalance : p.tokenABalance,
    swapFeeBps: Number(p.swapFeeRate) || 30,
  };
}

// Multi-coin StablePool via the coins table.
async function findMultiStablePool(token, usdst, asset) {
  // Same cirrus JSON-value quirk as Pool table: fetch per-token and merge in JS.
  // StablePool-coins.value is stored as JSON — PostgREST requires quoted literal
  const [rU, rA] = await Promise.all([
    cirrusGet(token, "BlockApps-StablePool-coins", { value: `eq."${usdst}"`, select: "address,key,value" }),
    cirrusGet(token, "BlockApps-StablePool-coins", { value: `eq."${asset}"`, select: "address,key,value" }),
  ]);
  const rows = [...(rU || []), ...(rA || [])];
  const byPool = new Map();
  for (const row of rows || []) {
    const slot = byPool.get(row.address) || { coinI: -1, coinJ: -1 };
    const v = (row.value || "").toLowerCase();
    if (v === usdst) slot.coinI = Number(row.key);
    else if (v === asset) slot.coinJ = Number(row.key);
    byPool.set(row.address, slot);
  }
  for (const [poolAddress, { coinI, coinJ }] of byPool) {
    if (coinI < 0 || coinJ < 0) continue;
    // Pull the USDST balance for this pool
    const bal = await cirrusGet(token, "BlockApps-StablePool-tokenBalances", {
      address: `eq.${poolAddress}`,
      key: `eq.${usdst}`,
      select: "value::text",
    });
    const assetBal = await cirrusGet(token, "BlockApps-StablePool-tokenBalances", {
      address: `eq.${poolAddress}`,
      key: `eq.${asset}`,
      select: "value::text",
    });
    return {
      poolAddress,
      poolType: 1,
      coinI,
      coinJ,
      usdstLiquidity: bal?.[0]?.value || "0",
      assetLiquidity: assetBal?.[0]?.value || "0",
      swapFeeBps: 30,
      multiCoin: true,
    };
  }
  return null;
}

async function resolvePool(token, assetLower) {
  const pair = await findPairPool(token, USDST, assetLower);
  if (pair) return pair;
  return findMultiStablePool(token, USDST, assetLower);
}

(async () => {
  if (!NODE_URL || !process.env.OAUTH_DISCOVERY_URL) {
    console.error("NODE_URL + OAUTH_DISCOVERY_URL required (from mercata/backend/.env)");
    process.exit(1);
  }
  if (!process.env.OAUTH_USERNAME || !process.env.OAUTH_PASSWORD) {
    console.error("OAUTH_USERNAME + OAUTH_PASSWORD required");
    process.exit(1);
  }
  const token = await getToken();
  const user = await getUserAddress(token);
  console.log(`User: ${user}`);

  const { data: bs } = await axios.get(`${BACKEND}/api/loop/bootstrap`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cdpAssets = bs.routes?.cdp?.assets || [];
  const opps = bs.opportunities || [];
  const oppByAsset = new Map(opps.map((o) => [o.asset.toLowerCase(), o]));

  const out = [];
  console.log(`\n${"Symbol".padEnd(11)} ${"MinCR".padStart(6)} ${"MaxLev".padStart(8)} ${"PoolType".padStart(10)} ${"CoinI/J".padStart(9)} ${"USDST liq".padStart(16)} ${"UserBal".padStart(14)} ${"Asset"}`);
  console.log("─".repeat(120));

  for (const asset of cdpAssets) {
    const assetLower = asset.address.toLowerCase();
    const opp = oppByAsset.get(assetLower);
    if (!opp) continue;
    const pool = await resolvePool(token, assetLower);
    if (!pool) continue;
    const bal = await getBalance(token, assetLower, user);
    const minCRpct = Number(asset.minCR);
    const maxLev = minCRpct > 100 ? minCRpct / (minCRpct - 100) : 1.0;
    const poolTypeLabel = pool.poolType === 0 ? "CP" : pool.multiCoin ? "STABLE_N" : "STABLE_2";
    const symbol = opp.symbol;

    console.log(
      `${String(symbol).padEnd(11)} ${String(minCRpct.toFixed(0) + "%").padStart(6)} ${String(maxLev.toFixed(2) + "x").padStart(8)} ${poolTypeLabel.padStart(10)} ${String(pool.coinI + "/" + pool.coinJ).padStart(9)} ${fmt(pool.usdstLiquidity).padStart(16)} ${fmt(bal).padStart(14)} ${asset.address.slice(0, 14)}...`,
    );

    out.push({
      symbol,
      asset: asset.address,
      minCR: minCRpct,
      liquidationRatio: Number(asset.liquidationRatio),
      maxLev: round(maxLev, 4),
      stabilityFeeRate: Number(asset.stabilityFeeRate),
      price: asset.price,
      unitScale: asset.unitScale || "1000000000000000000",
      baseYieldAPR: Number(opp.baseYieldAPR) || 0,
      pool,
      userBalance: bal.toString(),
    });
  }

  const outFile = "/tmp/loop_discovery.json";
  fs.writeFileSync(outFile, JSON.stringify({ user, usdst: USDST, combos: out }, null, 2));
  console.log(`\nWrote ${out.length} combos to ${outFile}`);
})().catch((e) => {
  console.error("ERR", e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 400));
  process.exit(1);
});

function round(n, dp) {
  const k = 10 ** dp;
  return Math.round(n * k) / k;
}
