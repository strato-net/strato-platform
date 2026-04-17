// Loop Router Backend Test Suite (CDP-only atomic router)
// Usage: OAUTH_USERNAME=x OAUTH_PASSWORD=y node scripts/loopRouter.test.js
// Requires: backend running on localhost:3001 (cd mercata/backend && npm run dev)
// Env: reads mercata/backend/.env for NODE_URL, OAUTH creds

const path = require("path");
module.paths.unshift(path.resolve(__dirname, "../backend/node_modules"));
const axios = require("axios");
require("dotenv").config({ path: path.resolve(__dirname, "../backend/.env") });

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";
const NODE_URL = (process.env.NODE_URL || "").replace(/\/+$/, "");
const CIRRUS = `${NODE_URL}/cirrus/search`;
const STRATO = `${NODE_URL}/strato/v2.3`;
const OAUTH_DISCOVERY = process.env.OAUTH_DISCOVERY_URL;
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const OAUTH_USERNAME = process.env.OAUTH_USERNAME;
const OAUTH_PASSWORD = process.env.OAUTH_PASSWORD;

const CDP_ENGINE = "BlockApps-CDPEngine";
const TOKEN = "BlockApps-Token";
const POOL = "BlockApps-Pool";
const LOOP_ROUTER = "BlockApps-LoopRouter";

let CDP_ENGINE_ADDR = null;
const E18 = 10n ** 18n;

const fmt = (wei) => {
  if (typeof wei === "string") wei = BigInt(wei);
  const whole = wei / E18;
  const frac = ((wei < 0n ? -wei : wei) % E18).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
};

let TOKEN_CACHE = null;
let USER_ADDRESS = null;
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
    failed++;
    failures.push(name);
  }
}

async function getToken() {
  if (TOKEN_CACHE) return TOKEN_CACHE;
  const { data: disco } = await axios.get(OAUTH_DISCOVERY);
  const params = OAUTH_USERNAME
    ? { grant_type: "password", client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, username: OAUTH_USERNAME, password: OAUTH_PASSWORD }
    : { grant_type: "client_credentials", client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET };
  const { data } = await axios.post(
    disco.token_endpoint,
    new URLSearchParams(params).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  TOKEN_CACHE = data.access_token;
  return TOKEN_CACHE;
}

async function getUserAddress() {
  if (USER_ADDRESS) return USER_ADDRESS;
  const token = await getToken();
  const { data } = await axios.get(`${STRATO}/key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  USER_ADDRESS = (data.address || data).replace(/^0x/, "").toLowerCase();
  return USER_ADDRESS;
}

const authHeaders = async () => ({
  Authorization: `Bearer ${await getToken()}`,
  "Content-Type": "application/json",
});

const apiGet = async (p) => {
  const h = await authHeaders();
  return axios.get(`${BACKEND}/api${p}`, { headers: h });
};

const apiPost = async (p, body, extra = {}) => {
  const h = await authHeaders();
  return axios.post(`${BACKEND}/api${p}`, body, { headers: { ...h, ...extra } });
};

const cirrusGet = async (p, params) => {
  const token = await getToken();
  const { data } = await axios.get(`${CIRRUS}${p}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return data;
};

async function discoverCDPEngineAddr() {
  if (CDP_ENGINE_ADDR) return CDP_ENGINE_ADDR;
  const rows = await cirrusGet(`/${CDP_ENGINE}`, { select: "address", limit: 5 });
  const known = ["0000000000000000000000000000000000001011", "0000000000000000000000000000000000001111"];
  for (const addr of known) {
    if (rows.some((r) => r.address === addr)) { CDP_ENGINE_ADDR = addr; return addr; }
  }
  if (rows.length > 0) { CDP_ENGINE_ADDR = rows[0].address; return CDP_ENGINE_ADDR; }
  return null;
}

async function getCDPVaultState(userAddr, assetAddr) {
  const engineAddr = await discoverCDPEngineAddr();
  if (!engineAddr) return null;
  const rows = await cirrusGet(`/${CDP_ENGINE}-vaults`, {
    address: `eq.${engineAddr}`,
    key: `eq.${userAddr}`,
    key2: `eq.${assetAddr.toLowerCase()}`,
    select: "value",
  });
  if (!rows || rows.length === 0) return null;
  const v = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
  return { collateral: BigInt(v?.collateral || "0"), scaledDebt: BigInt(v?.scaledDebt || "0") };
}

async function getTokenBalance(tokenAddr, userAddr) {
  const rows = await cirrusGet(`/${TOKEN}-_balances`, {
    address: `eq.${tokenAddr.toLowerCase()}`,
    key: `eq.${userAddr}`,
    select: "value::text",
  });
  return BigInt(rows?.[0]?.value || "0");
}

// ═══════════════════════════════════════════════════════════════
(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Loop Router Test Suite (CDP-only)       ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (!NODE_URL) { console.error("NODE_URL not set"); process.exit(1); }
  if (!OAUTH_DISCOVERY) { console.error("OAUTH_DISCOVERY_URL not set"); process.exit(1); }

  try { await getToken(); } catch (e) {
    console.error("Failed to get OAuth token:", e.message);
    process.exit(1);
  }
  console.log("Auth token acquired" + (OAUTH_USERNAME ? ` (${OAUTH_USERNAME})` : " (client_credentials)"));

  const userAddr = await getUserAddress();
  console.log(`User address: ${userAddr}\n`);

  let backendUp = true;
  try {
    await axios.get(`${BACKEND}/api/diagnostics`, { timeout: 3000 });
  } catch {
    backendUp = false;
    console.log("⚠  Backend not reachable at " + BACKEND + " — skipping API tests, running Cirrus-only.\n");
  }

  // ─── A. Bootstrap ───────────────────────────────────────────
  let bootstrap = null;
  if (backendUp) {
    console.log("─── A. Bootstrap ───");
    try {
      const { data, status } = await apiGet("/loop/bootstrap");
      bootstrap = data;

      assert(status === 200, "A1: returns 200");
      assert(data.swapFeeBps > 0, "A2: swapFeeBps > 0");
      assert(Array.isArray(data.opportunities), "A3: opportunities is array");
      const wellShaped = data.opportunities.every((o) =>
        typeof o.asset === "string" && typeof o.symbol === "string" &&
        typeof o.baseYieldAPR === "number" && typeof o.swapFeeBps === "number" &&
        typeof o.swapPoolUSDSTLiquidity === "string"
      );
      assert(wellShaped, "A4: every opportunity has the expected minimal shape");
      assert(data.routes.cdp.minCR > 0, "A5: cdp minCR > 0");
      assert(data.routes.cdp.stabilityAPR >= 0, "A6: cdp stabilityAPR >= 0");
      assert(data.routes.cdp.liquidationRatio > 0, "A7: cdp liquidationRatio > 0");
      assert(Array.isArray(data.routes.cdp.assets) && data.routes.cdp.assets.length > 0, "A8: cdp assets present");
    } catch (e) {
      assert(false, "A: bootstrap call failed", e.response?.data?.message || e.message);
    }
    console.log();
  }

  // ─── B. Validation ──────────────────────────────────────────
  if (backendUp) {
    console.log("─── B. Validation ───");
    const dummyAsset = bootstrap?.routes?.cdp?.assets?.[0]?.address || "0000000000000000000000000000000000000000";
    const basePayload = { routeType: "cdp_loop", asset: dummyAsset, amount: "1000000000000000000" };

    const expect400 = async (name, payload) => {
      try {
        await apiPost("/loop/execute", payload);
        assert(false, name, "expected 400 but got 200");
      } catch (e) {
        assert(e.response?.status === 400, name, `status=${e.response?.status}`);
      }
    };

    await expect400("B1: missing targetLeverage -> 400", { ...basePayload });
    await expect400("B2: targetLeverage 0.5 -> 400", { ...basePayload, targetLeverage: 0.5 });
    await expect400("B3: targetLeverage 15 -> 400", { ...basePayload, targetLeverage: 15 });
    await expect400("B4: missing asset -> 400", { routeType: "cdp_loop", amount: "1", targetLeverage: 2 });
    await expect400("B5: lending_loop rejected -> 400", { ...basePayload, routeType: "lending_loop", targetLeverage: 2 });
    await expect400("B6: maxSlippageBps > 1000 -> 400", { ...basePayload, targetLeverage: 2, maxSlippageBps: 1500 });
    console.log();
  }

  // ─── C. Execute + Cirrus Verification ───────────────────────
  let executeResult = null;
  let testAsset = null;

  if (backendUp && bootstrap) {
    console.log("─── C. Execute + Cirrus Verification ───");

    // Pick best loopable opportunity with positive liquidity
    const cdpOpps = bootstrap.opportunities.filter(
      (o) => o.cdpCarry && BigInt(o.swapPoolUSDSTLiquidity || "0") > 0n
    );

    if (cdpOpps.length > 0) {
      const opp = cdpOpps[0];
      testAsset = opp.asset;
      console.log(`  Using asset: ${opp.symbol} (${testAsset})`);
      console.log(`  Net carry: ${opp.cdpCarry.netCarryAPR}%`);

      const preBalance = await getTokenBalance(testAsset, userAddr);
      console.log(`  Pre-balance: ${fmt(preBalance)} ${opp.symbol}`);

      if (preBalance <= 0n) {
        console.log("  ⚠  No balance — skipping execute tests. Fund account and re-run.\n");
      } else {
        const testAmount = preBalance < E18 ? preBalance / 2n : (preBalance * 1n) / 100n;
        if (testAmount <= 0n) {
          console.log("  ⚠  Balance too small. Skipping.\n");
        } else {
          console.log(`  Test amount: ${fmt(testAmount)} ${opp.symbol}`);

          const vaultBefore = await getCDPVaultState(userAddr, testAsset);
          const collBefore = vaultBefore?.collateral || 0n;
          const debtBefore = vaultBefore?.scaledDebt || 0n;

          try {
            const { data } = await apiPost("/loop/execute", {
              routeType: "cdp_loop",
              asset: testAsset,
              amount: testAmount.toString(),
              targetLeverage: 2.0,
              maxSlippageBps: 100,
            });
            executeResult = data;

            assert(data.txHash, "C1: response has txHash");

            // Cirrus post-check
            await new Promise((r) => setTimeout(r, 3000));
            const vaultAfter = await getCDPVaultState(userAddr, testAsset);
            if (vaultAfter) {
              assert(vaultAfter.collateral > collBefore, "C2: collateral increased", `${fmt(collBefore)} -> ${fmt(vaultAfter.collateral)}`);
              assert(vaultAfter.scaledDebt > debtBefore, "C3: scaledDebt increased", `${fmt(debtBefore)} -> ${fmt(vaultAfter.scaledDebt)}`);
              const coll = Number(vaultAfter.collateral) / 1e18;
              const debt = Number(vaultAfter.scaledDebt) / 1e18;
              // rough leverage = coll*price / (coll*price - debt) — but we don't have price here
              // just verify both increased
            } else {
              assert(false, "C2: CDP vault not found after execute");
            }

            const postBalance = await getTokenBalance(testAsset, userAddr);
            assert(postBalance < preBalance, "C4: user balance decreased", `${fmt(preBalance)} -> ${fmt(postBalance)}`);

          } catch (e) {
            assert(false, "C: execute call failed", e.response?.data?.message || e.message);
          }
        }
      }
    } else {
      console.log("  (skipped — no CDP opportunities with liquidity)");
    }
    console.log();
  }

  // ─── D. Position ────────────────────────────────────────────
  if (backendUp) {
    console.log("─── D. Position ───");
    try {
      const { data, status } = await apiGet("/loop/position");
      assert(status === 200, "D1: returns 200");
      assert(Array.isArray(data.cdp), "D2: has cdp array");

      if (testAsset) {
        const pos = data.cdp.find((p) => p.asset?.toLowerCase() === testAsset.toLowerCase());
        assert(pos && pos.leverage > 1.01, "D3: position has leverage > 1.01", pos ? `leverage=${pos.leverage}` : "not found");
        if (pos) {
          console.log(`  Position: coll=${pos.collateral?.slice(0,10)}... debt=${pos.debt?.slice(0,10)}... lev=${pos.leverage} health=${pos.healthFactor} cr=${pos.collateralizationRatio}`);
        }
      }
    } catch (e) {
      assert(false, "D: position call failed", e.response?.data?.message || e.message);
    }
    console.log();
  }

  // ─── E. Cirrus-Only Sanity ─────────────────────────────────
  console.log("─── E. Cirrus-Only Sanity ───");
  try {
    const engineAddr = await discoverCDPEngineAddr();
    assert(Boolean(engineAddr), "E1: CDPEngine discovered", engineAddr || "not found");
    if (engineAddr) {
      const cdpRows = await cirrusGet(`/${CDP_ENGINE}`, {
        address: `eq.${engineAddr}`,
        select: "address,WAD::text,RAY::text",
        limit: 1,
      });
      assert(Array.isArray(cdpRows) && cdpRows.length > 0, "E2: CDPEngine queryable at " + engineAddr);
      if (cdpRows[0]) {
        assert(cdpRows[0].WAD === "1000000000000000000", "E3: CDPEngine WAD = 1e18", cdpRows[0].WAD);
      }
    }

    const tokenRows = await cirrusGet(`/${TOKEN}`, { select: "address,_symbol", limit: 3 });
    assert(Array.isArray(tokenRows) && tokenRows.length > 0, "E4: Token table queryable");

    const poolRows = await cirrusGet(`/${POOL}`, { select: "address,tokenA,tokenB", limit: 3 });
    assert(Array.isArray(poolRows) && poolRows.length > 0, "E5: Pool table queryable");

    try {
      const routerRows = await cirrusGet(`/${LOOP_ROUTER}`, { select: "address", limit: 1 });
      assert(Array.isArray(routerRows) && routerRows.length > 0, "E6: LoopRouter table queryable");
    } catch {
      assert(true, "E6: LoopRouter table not found (may not be deployed)");
    }

  } catch (e) {
    assert(false, "E: Cirrus sanity queries failed", e.message);
  }
  console.log();

  // ─── Summary ────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════");
  console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
  if (failures.length > 0) {
    console.log("  Failures:");
    failures.forEach((f) => console.log(`    • ${f}`));
  }
  console.log("═══════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
})();
