// Loop sweep: run leverageUp at min / mid / max per discovered combo and record
// pool + vault state. Writes one /tmp/sweep_<symbol>.txt per asset in the format
// composeReportTable.py expects. Rebalances CP pools to oracle before each run.
//
// Usage:
//   OAUTH_USERNAME=x OAUTH_PASSWORD=y node scripts/loopSweep.js
// Reads /tmp/loop_discovery.json from loopDiscover.js.

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
const PRICE_ORACLE = (process.env.PRICE_ORACLE || "0000000000000000000000000000000000001002").toLowerCase();
const CDP_ENGINE = "0000000000000000000000000000000000001011";
const SWEEP_DIR = "/tmp";

const E18 = 10n ** 18n;
const WAD = 10n ** 18n;

const fmt = (w) => {
  const x = BigInt(w);
  const whole = x / E18;
  const frac = ((x < 0n ? -x : x) % E18).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
};
const pct = (n, dp = 2) => `${n.toFixed(dp)}%`;

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

const authH = (token) => ({ Authorization: `Bearer ${token}` });

async function cirrusGet(token, table, params) {
  const { data } = await axios.get(`${CIRRUS}/${table}`, { headers: authH(token), params });
  return data;
}

async function postTx(token, txs) {
  const { data } = await axios.post(
    `${STRATO}/transaction?resolve=true`,
    { txs },
    { headers: authH(token), timeout: 300000 },
  );
  return data;
}

async function getPoolReserves(token, poolAddress, poolType) {
  if (poolType === 0) {
    const rows = await cirrusGet(token, "BlockApps-Pool", {
      address: `eq.${poolAddress}`,
      select: "tokenABalance::text,tokenBBalance::text,tokenA,tokenB",
    });
    if (!rows || rows.length === 0) return null;
    return {
      tokenA: rows[0].tokenA.toLowerCase(),
      tokenB: rows[0].tokenB.toLowerCase(),
      balanceA: rows[0].tokenABalance,
      balanceB: rows[0].tokenBBalance,
    };
  }
  return null;
}

async function getOraclePrice(token, asset) {
  const rows = await cirrusGet(token, "BlockApps-PriceOracle-prices", {
    address: `eq.${PRICE_ORACLE}`,
    key: `eq.${asset.toLowerCase()}`,
    select: "value::text",
  });
  return BigInt(rows?.[0]?.value || "0");
}

async function getVault(token, user, asset) {
  const rows = await cirrusGet(token, "BlockApps-CDPEngine-vaults", {
    address: `eq.${CDP_ENGINE}`,
    key: `eq.${user}`,
    key2: `eq.${asset.toLowerCase()}`,
    select: "value",
  });
  const v = rows?.[0]?.value;
  if (!v) return { collateral: 0n, scaledDebt: 0n };
  const parsed = typeof v === "string" ? JSON.parse(v) : v;
  return { collateral: BigInt(parsed.collateral || "0"), scaledDebt: BigInt(parsed.scaledDebt || "0") };
}

async function getBalance(token, tokenAddr, user) {
  const rows = await cirrusGet(token, "BlockApps-Token-_balances", {
    address: `eq.${tokenAddr.toLowerCase()}`,
    key: `eq.${user}`,
    select: "value::text",
  });
  return BigInt(rows?.[0]?.value || "0");
}

// Approximate integer sqrt
function isqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Rebalance CP pool so AMM mid-price ≈ oracle price.
async function rebalancePool(token, user, combo) {
  if (combo.pool.poolType !== 0) {
    console.log("    (skip rebalance: not CP)");
    return;
  }
  const r = await getPoolReserves(token, combo.pool.poolAddress, 0);
  if (!r) return;
  const price = await getOraclePrice(token, combo.asset); // USDST per asset * 1e18
  if (price === 0n) return;
  // tokenA is asset or USDST; we want USDST/asset spot = reserveUSDST/reserveAsset = price/WAD.
  const rAsset = BigInt(r.tokenA === USDST ? r.balanceB : r.balanceA);
  const rUsdst = BigInt(r.tokenA === USDST ? r.balanceA : r.balanceB);
  if (rAsset === 0n || rUsdst === 0n) return;
  const k = rAsset * rUsdst;
  // Target rAsset such that rU/rA = price/WAD → rA_target = sqrt(k*WAD/price)
  const target = isqrt((k * WAD) / price);
  const delta = target > rAsset ? target - rAsset : rAsset - target;
  const driftBps = Number((delta * 10000n) / rAsset);
  if (driftBps < 30) {
    console.log(`    pool drift ${driftBps} bps — skip rebalance`);
    return;
  }
  // When rA > target: pool has too much asset → swap USDST IN (reduces rA).
  // When rA < target: pool needs more asset → swap asset IN (increases rA).
  const needLessAsset = rAsset > target;
  const inputIsUsdst = needLessAsset;
  const poolIsUsdstTokenA = r.tokenA === USDST;
  const inputIsTokenA = inputIsUsdst ? poolIsUsdstTokenA : !poolIsUsdstTokenA;
  const isAToB = inputIsTokenA;
  const inputTok = inputIsTokenA ? r.tokenA : r.tokenB;
  // Analytic amounts (CP invariant, netIn ignores fee):
  //   USDST in:  netIn = rU × (rA - target) / target
  //   asset in:  netIn = target - rA
  let netIn;
  if (needLessAsset) {
    netIn = (rUsdst * (rAsset - target)) / target;
  } else {
    netIn = target - rAsset;
  }
  // Gross amountIn to cover 30 bps swap fee: amountIn = netIn / 0.997 = netIn * 10000 / 9970
  const swapIn = (netIn * 10000n) / 9970n;
  if (swapIn === 0n) return;

  console.log(`    rebalance: drift ${driftBps} bps, swapping ${fmt(swapIn)} ${inputTok.slice(0, 8)}... (isAToB=${isAToB})`);
  const txs = [
    {
      payload: {
        contractAddress: inputTok,
        method: "approve",
        args: { spender: combo.pool.poolAddress, value: swapIn.toString() },
        value: "0",
        metadata: { VM: "SolidVM" },
      },
      type: "FUNCTION",
    },
    {
      payload: {
        contractAddress: combo.pool.poolAddress,
        method: "swap",
        args: {
          isAToB,
          amountIn: swapIn.toString(),
          minAmountOut: "1",
          deadline: (Math.floor(Date.now() / 1000) + 600).toString(),
        },
        value: "0",
        metadata: { VM: "SolidVM" },
      },
      type: "FUNCTION",
    },
  ];
  try {
    await postTx(token, txs);
    await new Promise((r) => setTimeout(r, 2500));
  } catch (e) {
    console.log(`    rebalance swap failed: ${e.response?.data?.error?.message || e.message}`);
  }
}

// Unwind by calling the contract directly, bypassing broken backend endpoints.
// Steps: swap enough collateral to USDST to cover owed debt, repayAll, withdraw.
async function unwind(token, user, combo) {
  const asset = combo.asset.toLowerCase();
  const vault = await getVault(token, user, asset);
  if (vault.collateral === 0n && vault.scaledDebt === 0n) return;

  // Repay first (needs USDST balance). If we have outstanding debt, obtain USDST.
  if (vault.scaledDebt > 0n) {
    // rateAccumulator: fetch from collateralGlobalStates for accurate owed
    const rows = await cirrusGet(token, "BlockApps-CDPEngine-collateralGlobalStates", {
      address: `eq.${CDP_ENGINE}`, key: `eq.${asset}`, select: "value",
    });
    const gs = rows?.[0]?.value ? (typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value) : {};
    const rateAcc = BigInt(gs.rateAccumulator || "1000000000000000000000000000");
    const owed = (vault.scaledDebt * rateAcc) / (10n ** 27n);
    const ownedWithSlack = (owed * 102n) / 100n; // 2% slack for fees/rounding

    const usdstBal = await getBalance(token, USDST, user);
    if (usdstBal < ownedWithSlack) {
      // Swap collateral → USDST to cover. Estimate: collIn ≈ owedUSD / priceFloat
      const priceFloat = Number(BigInt(combo.price || "0")) / Number(BigInt(combo.unitScale || "1000000000000000000"));
      const needUsdst = ownedWithSlack - usdstBal;
      const needUsdstFloat = Number(needUsdst) / 1e18;
      const collToSwap = BigInt(Math.ceil((needUsdstFloat / priceFloat) * 1.02 * 1e18));
      // isAToB from pool perspective: input = collateral. If collateral is tokenA, AToB=true.
      const poolRow = await cirrusGet(token, "BlockApps-Pool", {
        address: `eq.${combo.pool.poolAddress}`, select: "tokenA",
      });
      const tokenAIsColl = poolRow?.[0]?.tokenA?.toLowerCase() === asset;
      const isAToB = tokenAIsColl;
      try {
        await postTx(token, [
          {
            payload: {
              contractAddress: asset, method: "approve",
              args: { spender: combo.pool.poolAddress, value: collToSwap.toString() },
              value: "0", metadata: { VM: "SolidVM" },
            },
            type: "FUNCTION",
          },
          {
            payload: {
              contractAddress: combo.pool.poolAddress, method: "swap",
              args: {
                isAToB, amountIn: collToSwap.toString(), minAmountOut: "1",
                deadline: (Math.floor(Date.now() / 1000) + 600).toString(),
              },
              value: "0", metadata: { VM: "SolidVM" },
            },
            type: "FUNCTION",
          },
        ]);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.log(`    unwind swap failed: ${e.response?.data?.error?.message || e.message}`);
      }
    }
    // repayAll
    try {
      await postTx(token, [{
        payload: {
          contractAddress: CDP_ENGINE, method: "repayAll",
          args: { asset }, value: "0", metadata: { VM: "SolidVM" },
        },
        type: "FUNCTION",
      }]);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.log(`    repayAll failed: ${e.response?.data?.error?.message || e.message}`);
    }
  }

  // withdraw all collateral
  const freshVault = await getVault(token, user, asset);
  if (freshVault.collateral > 0n) {
    try {
      await postTx(token, [{
        payload: {
          contractAddress: CDP_ENGINE, method: "withdraw",
          args: { asset, amount: freshVault.collateral.toString() },
          value: "0", metadata: { VM: "SolidVM" },
        },
        type: "FUNCTION",
      }]);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.log(`    withdraw failed: ${e.response?.data?.error?.message || e.message}`);
    }
  }
}

async function executeLeverage(token, asset, amount, targetLeverage, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data } = await axios.post(
        `${BACKEND}/api/loop/execute`,
        {
          routeType: "cdp_loop",
          asset,
          amount: amount.toString(),
          targetLeverage,
          maxSlippageBps: 200,
        },
        { headers: authH(token), timeout: 300000 },
      );
      return data;
    } catch (e) {
      lastErr = e;
      const msg = e.response?.data?.error?.message || e.message;
      // Retry on nonce races; fail fast otherwise
      if (/low tx nonce|nonce/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getPosition(token, asset, user) {
  // Position with all derived metrics via backend.
  const { data } = await axios.get(`${BACKEND}/api/loop/position`, { headers: authH(token) });
  const pos = (data.cdp || []).find((p) => p.asset?.toLowerCase() === asset.toLowerCase());
  return pos;
}

function computeAmount(combo) {
  // Cap: 1% of USDST pool liquidity in asset-denominated terms, capped by user balance.
  // amount_tokens = 0.01 * usdstLiq / (price / WAD)
  const liq = BigInt(combo.pool.usdstLiquidity || "0");
  const price = BigInt(combo.price || "0");
  const unit = BigInt(combo.unitScale || "1000000000000000000");
  if (liq === 0n || price === 0n) return 0n;
  const maxByLiq = (liq * unit) / (price * 100n);    // 1% of liq
  const balance = BigInt(combo.userBalance || "0");
  const cap = balance < maxByLiq ? balance : maxByLiq;
  // Leave a safety margin (90% of cap) so price tick during sweep doesn't push us over
  return (cap * 9n) / 10n;
}

function leveragePoints(maxLev) {
  const min = 1.5;
  const max = Math.floor(maxLev * 100) / 100; // theoretical maximum
  const mid = Math.round(((min + max) / 2) * 20) / 20; // nearest 0.05
  return [min, mid, Math.max(max, min + 0.2)];
}

async function runOne(token, user, combo) {
  const outFile = path.join(SWEEP_DIR, `sweep_${combo.symbol}.txt`);
  const amount = computeAmount(combo);
  if (amount <= 0n) {
    console.log(`  skip ${combo.symbol}: amount 0 (liq or balance)`);
    return null;
  }
  const price = BigInt(combo.price || "0");
  const unit = BigInt(combo.unitScale || "1000000000000000000");
  const priceFloat = Number(price) / Number(unit);
  const borrow = combo.stabilityFeeRate || 2.0;

  const metadata = {
    symbol: combo.symbol,
    price: priceFloat,
    baseYield: combo.baseYieldAPR || 0,
    borrow,
    poolType: combo.pool.poolType,
    units: `${fmt(amount)} ${combo.symbol}`,
    asset: combo.asset,
    poolAddress: combo.pool.poolAddress,
    coinI: combo.pool.coinI,
    coinJ: combo.pool.coinJ,
  };
  const header = `METADATA=${JSON.stringify(metadata)}\n---\n`;
  fs.writeFileSync(outFile, header);

  const targets = leveragePoints(combo.maxLev);
  console.log(`\n── ${combo.symbol} (${combo.pool.poolType === 0 ? "CP" : "STABLE"}) ──`);
  console.log(`   asset:  ${combo.asset}`);
  console.log(`   pool:   ${combo.pool.poolAddress}  coinI/J=${combo.pool.coinI}/${combo.pool.coinJ}`);
  console.log(`   price:  $${priceFloat.toFixed(4)}  yield: ${combo.baseYieldAPR}%  borrow: ${borrow}%`);
  console.log(`   amount: ${fmt(amount)} ${combo.symbol}  targets: ${targets.join(", ")}`);

  const results = [];
  for (const target of targets) {
    console.log(`  ▸ target ${target}x`);
    // ensure clean vault state
    await unwind(token, user, combo);
    await rebalancePool(token, user, combo);

    // Snapshot pool state (tokenA/B)
    const before = await getPoolReserves(token, combo.pool.poolAddress, combo.pool.poolType) || { balanceA: "0", balanceB: "0" };
    try {
      const execRes = await executeLeverage(token, combo.asset, amount, target);
      await new Promise((r) => setTimeout(r, 4000));
      const after = await getPoolReserves(token, combo.pool.poolAddress, combo.pool.poolType) || { balanceA: "0", balanceB: "0" };
      const pos = await getPosition(token, combo.asset, user);
      if (!pos) {
        console.log(`    position not found post-exec`);
        continue;
      }
      const block = [
        `TARGET=${target}`,
        `POOL_BEFORE_A=${before.balanceA}`,
        `POOL_BEFORE_B=${before.balanceB}`,
        `POOL_AFTER_A=${after.balanceA}`,
        `POOL_AFTER_B=${after.balanceB}`,
        `POSITION=${JSON.stringify(pos)}`,
        `TX=${execRes.txHash || ""}`,
        "---",
      ].join("\n") + "\n";
      fs.appendFileSync(outFile, block);
      results.push({ target, leverage: pos.leverage, cr: pos.collateralizationRatio });
      console.log(`    lev=${pos.leverage}x cr=${pos.collateralizationRatio}% hf=${pos.healthFactor}`);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      console.log(`    execute failed: ${msg}`);
      fs.appendFileSync(outFile, `TARGET=${target}\nERROR=${msg}\n---\n`);
    }
  }
  // Final cleanup
  await unwind(token, user, combo);
  return results;
}

(async () => {
  if (!fs.existsSync("/tmp/loop_discovery.json")) {
    console.error("/tmp/loop_discovery.json not found — run loopDiscover.js first");
    process.exit(1);
  }
  const { user, combos } = JSON.parse(fs.readFileSync("/tmp/loop_discovery.json", "utf8"));
  const token = await getToken();

  // Optional CLI filter: --only <symbol1,symbol2>
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.toLowerCase()) : null;

  // Pre-filter: need balance > 0 and pool liquidity > 0
  const viable = combos.filter((c) => {
    if (only && !only.includes(c.symbol.toLowerCase())) return false;
    if (BigInt(c.userBalance || "0") === 0n) return false;
    if (BigInt(c.pool.usdstLiquidity || "0") === 0n) return false;
    return true;
  });

  console.log(`Sweeping ${viable.length} combos (skipped ${combos.length - viable.length} with no balance/liq)`);
  const summary = [];
  for (const combo of viable) {
    const r = await runOne(token, user, combo);
    summary.push({ symbol: combo.symbol, results: r });
  }

  console.log("\n═══ Summary ═══");
  for (const s of summary) {
    if (!s.results || s.results.length === 0) {
      console.log(`  ${s.symbol}: no results`);
      continue;
    }
    const str = s.results.map((r) => `${r.target}x→${r.leverage}`).join(", ");
    console.log(`  ${s.symbol}: ${str}`);
  }
})().catch((e) => {
  console.error("FATAL", e.response?.status, e.response?.data || e.message);
  process.exit(1);
});
