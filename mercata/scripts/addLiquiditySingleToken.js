/*
  Script: addSingleSidedLiquidity.js
  Purpose: Demonstrate a one-sided liquidity deposit into an existing pool
           and show before/after pool + LP state
*/

const axios = require("axios");
require("dotenv").config();

(async () => {
  const node = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!node) throw new Error("Set STRATO_NODE_URL or NODE_URL env var");
  const ROOT = node.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const cirrusBase = `${ROOT}/cirrus/search`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN env var required");

  const POOL = (process.env.POOL || "").toLowerCase();
  if (!POOL) throw new Error("POOL env var required");

  const TOKEN = (process.env.TOKEN || "").toLowerCase();
  if (!TOKEN) throw new Error("TOKEN env var required");

  const AMOUNT = process.env.AMOUNT || "0";
  if (AMOUNT === "0") throw new Error("AMOUNT env var required");

  const DEADLINE =
    process.env.DEADLINE ||
    String(Math.floor(Date.now() / 1000) + 3600);

  const CALLER = (process.env.CALLER || process.env.TO_ADDRESS || "").toLowerCase();
  if (!CALLER) throw new Error("CALLER or TO_ADDRESS env var required (the seeder account)");

  const headers = { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({
    type: "FUNCTION",
    payload: { contractName: name, contractAddress: addr, method, args }
  });

  const cirrusGet = async (table, params) => {
    const url = `${cirrusBase}${table}`;
    const { data } = await axios.get(url, { headers, params });
    return data;
  };

  // Helper for direct contract calls using transaction endpoint
  const callContract = async (contractName, address, method, args = []) => {
    let callArgs = {};
    if (method === "balanceOf" && args.length > 0) {
      // balanceOf expects the address as accountAddress parameter
      callArgs = { accountAddress: args[0] };
    } else if (args.length > 0) {
      callArgs = { args: args };
    }
    const tx = buildCall(contractName, address, method, callArgs);
    const url = `${BASE}/transaction/parallel?resolve=true`;
    const body = { txs: [tx] };
    // console.log(`Calling: ${url}`);
    // console.log(`Body:`, JSON.stringify(body, null, 2));
    const { data } = await axios.post(url, body, { headers });
    // console.log(`Response:`, data);
    if (data[0].status !== "Success") {
      throw new Error(`Contract call failed: ${JSON.stringify(data[0])}`);
    }
    const result = data[0].data.contents[0];
    // console.log(`Extracted result:`, result);
    return result;
  };

  // fetch state helper using Cirrus
  const fetchState = async () => {
    // Get pool info from Cirrus
    const poolRows = await cirrusGet("/BlockApps-Mercata-Pool", {
      address: `eq.${POOL}`,
      select: "tokenA,tokenB,lpToken,tokenABalance,tokenBBalance",
      limit: 1,
    });
    
    if (poolRows.length === 0) {
      throw new Error(`Pool ${POOL} not found in Cirrus`);
    }
    
    const poolData = poolRows[0];
    const lpToken = poolData.lpToken.toLowerCase();
    
    // Get LP token total supply directly from contract
    const totalLp = await callContract("Token", lpToken, "totalSupply");
    
    // Get caller's LP balance directly from LP token contract
    let callerLp;
    try {
      callerLp = await callContract("Token", lpToken, "balanceOf", [CALLER]);
    } catch (err) {
      console.warn("Could not get caller LP balance:", err.message);
      callerLp = "0";
    }

    return {
      tokenA: poolData.tokenA.toLowerCase(),
      tokenB: poolData.tokenB.toLowerCase(),
      lpToken: lpToken,
      reserveA: poolData.tokenABalance,
      reserveB: poolData.tokenBBalance,
      totalLp: totalLp,
      callerLp: callerLp
    };
  };

  console.log(`\n=== Single-sided Liquidity Deposit ===`);
  console.log(`Pool:      ${POOL}`);
  console.log(`Token In:  ${TOKEN}`);
  console.log(`Amount In: ${AMOUNT}`);
  // console.log(`Deadline:  ${DEADLINE}`);
  console.log(`Caller:    ${CALLER}`);

  const before = await fetchState();
  console.log("\n--- BEFORE ---");
  console.log(before);

  // figure out isAToB based on which token matches TOKEN
  let isAToB = true

  const txs = [
    buildCall("Token", TOKEN, "approve", { spender: POOL, value: AMOUNT }),
    buildCall("Pool", POOL, "addLiquiditySingleToken", {
      isAToB,
      amountIn: AMOUNT,
      deadline: DEADLINE,
    }),
  ];

  try {
    const body = { txs, txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    const { data: res } = await axios.post(txEndpoint, body, { headers });

    const failed = res.findIndex((r) => r.status !== "Success");
    if (failed !== -1) {
      console.error("❌ Transaction failed:", JSON.stringify(res[failed], null, 2));
      throw new Error("Single-sided addLiquidity failed");
    }
    console.log(`✔ Single-sided liquidity added, tx hash: ${res[1].hash}`);
  } catch (err) {
    console.error("Error submitting tx:", err.message || err);
    return;
  }

  const after = await fetchState();
  console.log("\n--- AFTER ---");
  console.log(after);

  console.log("\n--- DIFF ---");
  console.log(`Reserves A: ${before.reserveA} → ${after.reserveA}`);
  console.log(`Reserves B: ${before.reserveB} → ${after.reserveB}`);
  console.log(`Total LP:   ${before.totalLp} → ${after.totalLp}`);
  console.log(`Caller LP:  ${before.callerLp} → ${after.callerLp}`);
})();