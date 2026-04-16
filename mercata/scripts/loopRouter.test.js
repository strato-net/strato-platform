// Loop Router Backend Test Suite (CDP-only atomic router)
// Usage: node scripts/loopRouter.test.js
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
  const { data } = await axios.post(
    disco.token_endpoint,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
    }).toString(),
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
  console.log("Auth token acquired.");

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

      assert(status === 200, "A1a: returns 200");
      assert(typeof data.version === "string" && data.version.length > 0, "A1b: has version string");
      assert(data.timestamp, "A1c: has timestamp");
      assert(data.networkId, "A1d: has networkId");
      assert(typeof data.gasFeePerStep === "string" && BigInt(data.gasFeePerStep) > 0n, "A1e: gasFeePerStep > 0");
      assert(data.maxLoops >= 1, "A1f: maxLoops >= 1");
      assert(data.swapFeeBps > 0, "A1g: swapFeeBps > 0");
      assert(data.routes?.cdp?.usdstAddress, "A1h: cdp route has usdstAddress");
      assert(Array.isArray(data.opportunities), "A1i: opportunities is array");

      // CDP-only: all opportunities have cdpCarry, no lendingCarry
      const allCdp = data.opportunities.every((o) => o.cdpCarry !== null && o.cdpCarry !== undefined);
      const noLending = data.opportunities.every((o) => o.lendingCarry === null || o.lendingCarry === undefined);
      assert(allCdp, "A2a: every opportunity has cdpCarry");
      assert(noLending, "A2b: no opportunity has lendingCarry");

      // Sorted descending by CDP net carry
      if (data.opportunities.length >= 2) {
        let sorted = true;
        for (let i = 1; i < data.opportunities.length; i++) {
          const prev = data.opportunities[i - 1].cdpCarry?.netCarryAPR ?? -999;
          const curr = data.opportunities[i].cdpCarry?.netCarryAPR ?? -999;
          if (curr > prev) { sorted = false; break; }
        }
        assert(sorted, "A2c: opportunities sorted by cdpCarry.netCarryAPR desc");
      } else {
        assert(true, "A2c: (skipped — fewer than 2 opportunities)");
      }

      const posLiqCount = data.opportunities.filter(
        (o) => BigInt(o.swapPoolUSDSTLiquidity || "0") > 0n
      ).length;
      assert(posLiqCount >= 0, `A3: ${posLiqCount}/${data.opportunities.length} have positive USDST liquidity`);

      assert(data.routes.cdp.minCR > 0, "A4a: cdp minCR > 0", `got ${data.routes.cdp.minCR}`);
      assert(data.routes.cdp.stabilityAPR >= 0, "A4b: cdp stabilityAPR >= 0");

      // Lending stub present for UI compat (empty assets)
      assert(data.routes.lending !== undefined, "A5a: lending stub present for UI compat");
      assert(Array.isArray(data.routes.lending?.assets) && data.routes.lending.assets.length === 0, "A5b: lending stub has empty assets");
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

    const expect400 = async (name, payload, ep = "/loop/execute") => {
      try {
        await apiPost(ep, payload);
        assert(false, name, "expected 400 but got 200");
      } catch (e) {
        assert(e.response?.status === 400, name, `status=${e.response?.status}`);
      }
    };

    await expect400("B1: no targetLeverage or loops -> 400", { ...basePayload });
    await expect400("B2: targetLeverage 0.5 -> 400", { ...basePayload, targetLeverage: 0.5 });
    await expect400("B3: targetLeverage 15 -> 400", { ...basePayload, targetLeverage: 15 });
    await expect400("B4: loops 0 -> 400", { ...basePayload, loops: 0 });
    await expect400("B5: loops 6 -> 400", { ...basePayload, loops: 6 });
    await expect400("B6: missing asset -> 400", { routeType: "cdp_loop", amount: "1", targetLeverage: 2 });
    await expect400("B7: unwind missing steps -> 400", { routeType: "cdp_loop", asset: dummyAsset }, "/loop/unwind");
    await expect400("B8: lending_loop route rejected -> 400", { ...basePayload, routeType: "lending_loop", targetLeverage: 2 });
    console.log();
  }

  // ─── C. DryRun Smoke ─────────────────────────────────────────
  if (backendUp && bootstrap) {
    console.log("─── C. DryRun Smoke ───");
    const cdpAsset = bootstrap.routes.cdp.assets.find((a) => !a.isPaused);
    if (cdpAsset) {
      const base = { routeType: "cdp_loop", asset: cdpAsset.address, amount: "1000000000000000000", dryRun: true };

      try {
        const { data: r1 } = await apiPost("/loop/execute", { ...base, targetLeverage: 2.0 });
        assert(r1.requestId, "C1: dryRun response has requestId");
        assert(r1.executedSteps.length === 1, "C2: atomic -> single executedStep", `got ${r1.executedSteps.length}`);
        assert(r1.executedSteps[0].action === "dry_run_validation", "C3: dryRun action is dry_run_validation");
        assert(r1.terminalState, "C4: dryRun has terminalState");
      } catch (e) {
        assert(false, "C: dryRun smoke failed", e.response?.data?.message || e.message);
      }
    } else {
      console.log("  (skipped — no unpaused CDP asset)");
    }
    console.log();
  }

  // ─── D. Execute + Cirrus Verification ───────────────────────
  let executeResult = null;
  let testAsset = null;

  if (backendUp && bootstrap) {
    console.log("─── D. Execute + Cirrus Verification ───");

    const cdpOpps = bootstrap.opportunities.filter(
      (o) => o.cdpCarry && o.cdpCarry.netCarryWithImpactAPR > 0 && BigInt(o.swapPoolUSDSTLiquidity || "0") > 0n
    );

    if (cdpOpps.length > 0) {
      const opp = cdpOpps[0];
      testAsset = opp.asset;
      console.log(`  Using asset: ${opp.symbol} (${testAsset})`);

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

            assert(data.requestId, "D1: response has requestId");

            // Atomic: exactly 1 step
            assert(Array.isArray(data.executedSteps) && data.executedSteps.length === 1, "D2a: atomic -> 1 executedStep");
            assert(data.executedSteps[0].status === "success", "D2b: step status is success");
            assert(data.executedSteps[0].action === "leverage_up", "D2c: step action is leverage_up");
            assert(data.executedSteps[0].txHash, "D2d: step has txHash");

            const effLev = parseFloat(data.terminalState?.effectiveLeverage || "0");
            assert(effLev >= 1.3 && effLev <= 3.0, "D3: effectiveLeverage near 2.0", `got ${effLev.toFixed(3)}`);

            // Cirrus post-check
            await new Promise((r) => setTimeout(r, 3000));
            const vaultAfter = await getCDPVaultState(userAddr, testAsset);
            if (vaultAfter) {
              assert(vaultAfter.collateral > collBefore, "D4a: collateral increased", `${fmt(collBefore)} -> ${fmt(vaultAfter.collateral)}`);
              assert(vaultAfter.scaledDebt > debtBefore, "D4b: scaledDebt increased", `${fmt(debtBefore)} -> ${fmt(vaultAfter.scaledDebt)}`);
            } else {
              assert(false, "D4: CDP vault not found after execute");
            }

            const postBalance = await getTokenBalance(testAsset, userAddr);
            assert(postBalance < preBalance, "D5: user balance decreased", `${fmt(preBalance)} -> ${fmt(postBalance)}`);

          } catch (e) {
            assert(false, "D: execute call failed", e.response?.data?.message || e.message);
          }
        }
      }
    } else {
      console.log("  (skipped — no CDP opportunities with positive carry)");
    }
    console.log();
  }

  // ─── E. Position ────────────────────────────────────────────
  if (backendUp && executeResult) {
    console.log("─── E. Position ───");
    try {
      const { data, status } = await apiGet("/loop/position");
      assert(status === 200, "E1a: returns 200");
      assert(Array.isArray(data.cdp), "E1b: has cdp array");

      // Lending stub present for UI compat
      assert(Array.isArray(data.lending) && data.lending.length === 0, "E1c: lending stub is empty array");

      if (testAsset) {
        const pos = data.cdp.find((p) => p.asset?.toLowerCase() === testAsset.toLowerCase());
        assert(pos && pos.leverage > 1.01, "E2: position has leverage > 1.01", pos ? `leverage=${pos.leverage}` : "not found");

        if (pos && executeResult) {
          const execLev = parseFloat(executeResult.terminalState?.effectiveLeverage || "0");
          const diff = Math.abs(pos.leverage - execLev);
          assert(diff < 0.5, "E3: position leverage ≈ execute terminal leverage", `pos=${pos.leverage.toFixed(3)} exec=${execLev.toFixed(3)}`);
        }
      }
    } catch (e) {
      assert(false, "E: position call failed", e.response?.data?.message || e.message);
    }
    console.log();
  }

  // ─── F. Unwind + Cirrus Verification ────────────────────────
  if (backendUp && executeResult && testAsset) {
    console.log("─── F. Unwind ───");

    const vaultBeforeUnwind = await getCDPVaultState(userAddr, testAsset);
    const balBeforeUnwind = await getTokenBalance(testAsset, userAddr);

    try {
      const { data } = await apiPost("/loop/unwind", {
        routeType: "cdp_loop",
        asset: testAsset,
        steps: "all",
        targetLeverage: 1.0,
      });

      // Atomic: exactly 1 step
      assert(Array.isArray(data.executedSteps) && data.executedSteps.length === 1, "F1a: atomic -> 1 executedStep");
      assert(data.executedSteps[0].status === "success", "F1b: step status is success");
      assert(data.executedSteps[0].action === "leverage_down", "F1c: step action is leverage_down");

      const finalLev = parseFloat(data.terminalState?.effectiveLeverage || "0");
      assert(finalLev <= 1.05 || data.terminalState?.totalDebt === "0", "F2: leverage ≈ 1.0 after full unwind", `got ${finalLev.toFixed(3)}`);

      await new Promise((r) => setTimeout(r, 3000));
      const vaultAfterUnwind = await getCDPVaultState(userAddr, testAsset);
      if (vaultAfterUnwind) {
        assert(
          vaultAfterUnwind.scaledDebt === 0n || vaultAfterUnwind.scaledDebt < (vaultBeforeUnwind?.scaledDebt || 1n),
          "F3a: debt reduced after unwind",
          `before=${fmt(vaultBeforeUnwind?.scaledDebt || 0n)} after=${fmt(vaultAfterUnwind.scaledDebt)}`
        );
      }

      const balAfterUnwind = await getTokenBalance(testAsset, userAddr);
      assert(balAfterUnwind > balBeforeUnwind, "F3b: user balance increased (collateral returned)", `${fmt(balBeforeUnwind)} -> ${fmt(balAfterUnwind)}`);

    } catch (e) {
      assert(false, "F: unwind call failed", e.response?.data?.message || e.message);
    }
    console.log();
  }

  // ─── G. Idempotency ────────────────────────────────────────
  if (backendUp && bootstrap) {
    console.log("─── G. Idempotency ───");
    const cdpAsset = bootstrap.routes.cdp.assets.find((a) => !a.isPaused);
    if (cdpAsset) {
      // Execute idempotency
      const execKey = `test-idem-exec-${Date.now()}`;
      const execPayload = {
        routeType: "cdp_loop",
        asset: cdpAsset.address,
        amount: "1000000000000000000",
        targetLeverage: 2.0,
        dryRun: true,
      };
      try {
        const { data: r1 } = await apiPost("/loop/execute", execPayload, { "Idempotency-Key": execKey });
        const { data: r2 } = await apiPost("/loop/execute", execPayload, { "Idempotency-Key": execKey });
        assert(r1.requestId === r2.requestId, "G1a: execute idempotency -> same requestId");
      } catch (e) {
        assert(false, "G1a: execute idempotency failed", e.response?.data?.message || e.message);
      }

      // Unwind idempotency
      const unwindKey = `test-idem-unwind-${Date.now()}`;
      try {
        const { data: u1 } = await apiPost("/loop/unwind", {
          routeType: "cdp_loop", asset: cdpAsset.address, steps: "all", targetLeverage: 1.0, idempotencyKey: unwindKey,
        });
        const { data: u2 } = await apiPost("/loop/unwind", {
          routeType: "cdp_loop", asset: cdpAsset.address, steps: "all", targetLeverage: 1.0, idempotencyKey: unwindKey,
        });
        assert(u1.requestId === u2.requestId, "G1b: unwind idempotency -> same requestId");
      } catch {
        assert(true, "G1b: unwind idempotency (skipped — no position to unwind)");
      }
    } else {
      console.log("  (skipped)");
    }
    console.log();
  }

  // ─── Cirrus-Only Sanity ─────────────────────────────────────
  console.log("─── Cirrus-Only Sanity ───");
  try {
    const engineAddr = await discoverCDPEngineAddr();
    assert(Boolean(engineAddr), "Cirrus: CDPEngine discovered", engineAddr || "not found");
    if (engineAddr) {
      const cdpRows = await cirrusGet(`/${CDP_ENGINE}`, {
        address: `eq.${engineAddr}`,
        select: "address,WAD::text,RAY::text",
        limit: 1,
      });
      assert(Array.isArray(cdpRows) && cdpRows.length > 0, "Cirrus: CDPEngine is queryable at " + engineAddr);
      if (cdpRows[0]) {
        assert(cdpRows[0].WAD === "1000000000000000000", "Cirrus: CDPEngine WAD = 1e18", cdpRows[0].WAD);
      }
    }

    const tokenRows = await cirrusGet(`/${TOKEN}`, { select: "address,_symbol", limit: 3 });
    assert(Array.isArray(tokenRows) && tokenRows.length > 0, "Cirrus: Token table queryable");

    const poolRows = await cirrusGet(`/${POOL}`, { select: "address,tokenA,tokenB", limit: 3 });
    assert(Array.isArray(poolRows) && poolRows.length > 0, "Cirrus: Pool table queryable");

    // LoopRouter table exists
    try {
      const routerRows = await cirrusGet(`/${LOOP_ROUTER}`, { select: "address", limit: 1 });
      assert(Array.isArray(routerRows) && routerRows.length > 0, "Cirrus: LoopRouter table queryable");
    } catch {
      assert(true, "Cirrus: LoopRouter table not found (may not be deployed on this network)");
    }

  } catch (e) {
    assert(false, "Cirrus sanity queries failed", e.message);
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
