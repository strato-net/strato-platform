/* 
  Script: verifyStateAddLiquiditySingleToken.js
  Purpose: 
    - Fetch initial pool + wallet state from Cirrus
    - Call addLiquiditySingleToken() with USDST as the deposit token
    - Fetch post-call state and wallet balances
    - Print a concise before/after diff and the function return (liquidityMinted)

  Env vars required:
    - ADMIN_TOKEN              OAuth bearer for node
    - STRATO_NODE_URL or NODE_URL  Base node URL (e.g., https://host/strato/v2.3 or https://host)
    - POOL                     Pool address
    - USDST                    USDST token address (the deposit token)
    - CALLER                   The msg.sender address
    - AMOUNT                   Deposit amount in wei. If omitted, defaults to 10 * 10^decimals(USDST)
    - DEADLINE                 Unix timestamp; default now + 1 hour
*/

const axios = require("axios");
require("dotenv").config();
const auth = require("../../deploy/auth");

(async () => {
  // --- Setup ---
  const node = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!node) throw new Error("Set STRATO_NODE_URL or NODE_URL env var");
  const ROOT = node.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const cirrusBase = `${ROOT}/cirrus/search`;

  // Acquire access token: prefer ADMIN_TOKEN; else use GLOBAL_ADMIN_NAME/PASSWORD via oauth
  const getAccessToken = async () => {
    if (process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.trim() !== "") {
      return process.env.ADMIN_TOKEN.trim();
    }
    const name = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    if (name && password) {
      const tok = await auth.getUserToken(name, password);
      if (!tok) throw new Error("Failed to acquire token from GLOBAL_ADMIN credentials");
      return tok;
    }
    throw new Error("ADMIN_TOKEN or GLOBAL_ADMIN_NAME/GLOBAL_ADMIN_PASSWORD required");
  };
  const ADMIN_TOKEN = await getAccessToken();

  const POOL = (process.env.POOL || "0000000000000000000000000000000000001017").toLowerCase();
  if (!POOL) throw new Error("POOL env var required");

  const USDST = (process.env.USDST || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010").toLowerCase();
  if (!USDST) throw new Error("USDST env var required");

  const CALLER = (process.env.CALLER || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce").toLowerCase();
  if (!CALLER) throw new Error("CALLER or TO_ADDRESS env var required (the msg.sender)");

  const DEADLINE = process.env.DEADLINE || String(Math.floor(Date.now() / 1000) + 3600);

  const headers = { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({
    type: "FUNCTION",
    payload: { contractName: name, contractAddress: addr, method, args }
  });

  // --- Helpers ---
  const cirrusGet = async (path, params) => {
    const url = `${cirrusBase}${path}`;
    const { data } = await axios.get(url, { headers, params });
    return data;
  };

  // Read ERC-20 balance via Cirrus view
  const getBalanceCirrus = async (tokenAddr, holderAddr) => {
    const token = tokenAddr.replace(/^0x/, "").toLowerCase();
    const holder = holderAddr.replace(/^0x/, "").toLowerCase();
    const data = await cirrusGet("/BlockApps-Token-_balances", {
      key: `eq.${holder}`,
      address: `eq.${token}`,
      select: "balance:value::text",
      limit: 1
    });
    return data?.[0]?.balance || "0";
  };


  // Fetch decimals for USDST from Cirrus (customDecimals)
  const getTokenDecimals = async (tokenAddr) => {
    const rows = await cirrusGet("/BlockApps-Token", {
      address: `eq.${tokenAddr}`,
      select: "customDecimals",
      limit: 1
    });
    const dec = rows?.[0]?.customDecimals;
    if (dec === undefined || dec === null) throw new Error(`Unable to determine decimals for ${tokenAddr} via Cirrus`);
    return Number(dec);
  };

  // Fetch pool state (before/after)
  const fetchPoolState = async () => {
    const poolRows = await cirrusGet("/BlockApps-Pool", {
      address: `eq.${POOL}`,
      select: "tokenA,tokenB,lpToken,tokenABalance::text,tokenBBalance::text,swapFeeRate,lpSharePercent,zapSwapFeesEnabled,poolFactory",
      limit: 1
    });
    if (poolRows.length === 0) {
      throw new Error(`Pool ${POOL} not found in Cirrus`);
    }

    const p = poolRows[0];
    const tokenA = String(p.tokenA).toLowerCase();
    const tokenB = String(p.tokenB).toLowerCase();
    const lpToken = String(p.lpToken).toLowerCase();
    const reserveA = p.tokenABalance || "0";
    const reserveB = p.tokenBBalance || "0";
    const swapFeeRate = Number(p.swapFeeRate || 0);
    const lpSharePercent = Number(p.lpSharePercent || 0);
    const zapFees = !!p.zapSwapFeesEnabled;
    const factoryAddr = (p.poolFactory || "").toLowerCase();

    // LP totalSupply via Cirrus
    const lpRows = await cirrusGet("/BlockApps-Token", {
      address: `eq.${lpToken}`,
      select: "_totalSupply::text",
      limit: 1
    });
    const totalLp = lpRows?.[0]?._totalSupply || "0";

    return {
      tokenA,
      tokenB,
      lpToken,
      reserveA,
      reserveB,
      totalLp,
      swapFeeRate,
      lpSharePercent,
      zapFees,
      factoryAddr
    };
  };

  // Fetch factory-derived fee params and fee collector
  const fetchFactoryParams = async (factoryAddr) => {
    if (!factoryAddr) return { factorySwapFeeRate: 0, factoryLpSharePercent: 0, feeCollector: "" };
    const rows = await cirrusGet("/BlockApps-PoolFactory", {
      address: `eq.${factoryAddr}`,
      select: "swapFeeRate,lpSharePercent,feeCollector",
      limit: 1
    });
    const r = rows?.[0] || {};
    return {
      factorySwapFeeRate: Number(r.swapFeeRate || 0),
      factoryLpSharePercent: Number(r.lpSharePercent || 0),
      feeCollector: (r.feeCollector || "").toLowerCase()
    };
  };

  // --- Begin ---
  console.log(">> ENTER verifyStateAddLiquiditySingleToken");
  console.log(`POOL=${POOL}`);
  console.log(`USDST=${USDST}`);
  console.log(`CALLER=${CALLER}`);

  // Determine amountIn
  let amountIn = process.env.AMOUNT;
  if (!amountIn) {
    const dec = await getTokenDecimals(USDST);
    const base = BigInt(10) ** BigInt(dec);
    amountIn = (10n * base).toString(); // default 10 * 10^decimals
  }
  console.log(`amountIn=${amountIn}`);

  // Snapshot BEFORE
  const beforePool = await fetchPoolState();
  const isAToB = USDST === beforePool.tokenA;
  const otherToken = isAToB ? beforePool.tokenB : beforePool.tokenA;

  const { factorySwapFeeRate, factoryLpSharePercent, feeCollector } = await fetchFactoryParams(beforePool.factoryAddr);
  const effectiveFeeBps = beforePool.swapFeeRate > 0 ? beforePool.swapFeeRate : factorySwapFeeRate;
  const effectiveLpShareBps = beforePool.lpSharePercent > 0 ? beforePool.lpSharePercent : factoryLpSharePercent;

  const userUSDST0 = await getBalanceCirrus(USDST, CALLER);
  const userOther0 = await getBalanceCirrus(otherToken, CALLER);
  const userLP0 = await getBalanceCirrus(beforePool.lpToken, CALLER);
  const collectorUSDST0 = await getBalanceCirrus(USDST, feeCollector);

  console.log("\n--- BEFORE ---");
  console.log({
    isAToB,
    A0: beforePool.reserveA,
    B0: beforePool.reserveB,
    L0: beforePool.totalLp,
    feeBps: effectiveFeeBps,
    lpShareBps: effectiveLpShareBps,
    zapFees: beforePool.zapFees,
    feeCollector,
    userUSDST0,
    userOther0,
    userLP0,
    collectorUSDST0
  });

  // Submit approve + addLiquiditySingleToken
  const txs = [
    buildCall("Token", USDST, "approve", { spender: POOL, value: amountIn }),
    buildCall("Pool", POOL, "addLiquiditySingleToken", {
      isAToB,
      amountIn,
      deadline: DEADLINE
    })
  ];

  let liquidityMinted = "0";
  let txHash = "";
  try {
    const body = { txs, txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    const { data: res } = await axios.post(txEndpoint, body, { headers });
    const failed = res.findIndex((r) => r.status !== "Success");
    if (failed !== -1) {
      console.error("❌ Transaction failed:", JSON.stringify(res[failed], null, 2));
      throw new Error("addLiquiditySingleToken failed");
    }
    txHash = res[1]?.hash || "";
    liquidityMinted = String(res[1]?.data?.contents?.[0] ?? "0");
    console.log(`\n✔ addLiquiditySingleToken ok, tx hash: ${txHash}`);
    console.log(`liquidityMinted: ${liquidityMinted}`);
  } catch (err) {
    console.error("Error submitting tx:", err.message || err);
    console.log("<< EXIT verifyStateAddLiquiditySingleToken (failed)");
    return;
  }

  // Snapshot AFTER
  const afterPool = await fetchPoolState();
  const userUSDST1 = await getBalanceCirrus(USDST, CALLER);
  const userOther1 = await getBalanceCirrus(otherToken, CALLER);
  const userLP1 = await getBalanceCirrus(afterPool.lpToken, CALLER);
  const collectorUSDST1 = await getBalanceCirrus(USDST, feeCollector);

  console.log("\n--- AFTER ---");
  console.log({
    A1: afterPool.reserveA,
    B1: afterPool.reserveB,
    L1: afterPool.totalLp,
    userUSDST1,
    userOther1,
    userLP1,
    collectorUSDST1,
    liquidityMinted
  });

  // Diff summary (raw deltas; includes any chain fees charged to CALLER)
  const toBig = (x) => BigInt(String(x || "0"));
  const dA = toBig(afterPool.reserveA) - toBig(beforePool.reserveA);
  const dB = toBig(afterPool.reserveB) - toBig(beforePool.reserveB);
  const dL = toBig(afterPool.totalLp) - toBig(beforePool.totalLp);
  const dUserUSDST = toBig(userUSDST1) - toBig(userUSDST0);
  const dUserOther = toBig(userOther1) - toBig(userOther0);
  const dUserLP = toBig(userLP1) - toBig(userLP0);
  const dCollectorUSDST = toBig(collectorUSDST1) - toBig(collectorUSDST0);

  console.log("\n--- DIFF (post - pre) ---");
  console.log({
    deltaA: dA.toString(),
    deltaB: dB.toString(),
    deltaLP: dL.toString(),
    deltaUserUSDST: dUserUSDST.toString(),
    deltaUserOther: dUserOther.toString(),
    deltaUserLP: dUserLP.toString(),
    deltaCollectorUSDST: dCollectorUSDST.toString()
  });

  console.log("\nNote:");
  console.log("- Reserves show only the input-side increase (opposite side unchanged in this zap path).");
  console.log("- User deltas are raw and may include network fees if applicable to your STRATO environment.");
  console.log("<< EXIT verifyStateAddLiquiditySingleToken");
})();


