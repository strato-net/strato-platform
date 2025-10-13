/*
  Script: createKeyAssetPools.js
  Purpose: Ensure four key USDST swap pools exist and are seeded with ~$10k
           worth of liquidity each, at current spot prices you supplied.

  Required env vars:
    NODE_URL or STRATO_NODE_URL     – Strato base URL
    ADMIN_TOKEN                     – Admin JWT able to call PoolFactory.mint etc.
    POOL_FACTORY                    – Address of PoolFactory
    USDST                           – USD-stable token address (tokenA)

  Optional overrides (token addresses or amounts):
    ETHST, WBTCST, GOLDST, SILVST   – tokenB addresses
    AMT_ETHST, AMT_WBTCST, AMT_GOLDST, AMT_SILVST – tokenB amounts (wei)
    DEPOSIT_USDST                   – tokenA amount to deposit per pool (wei, default 1e22)

  Usage example:
    export NODE_URL=https://node.mercata.xyz
    export ADMIN_TOKEN=<jwt>
    export POOL_FACTORY=000000000000000000000000000000000000100a
    export USDST=86a5ae535ded415203c3e27d654f9a1d454c553b
    node scripts/createKeyAssetPools.js
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
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN env var is required");

  const POOL_FACTORY = (process.env.POOL_FACTORY || "").toLowerCase();
  if (!POOL_FACTORY) throw new Error("POOL_FACTORY env var required");

  const USDST = (process.env.USDST || "").toLowerCase();
  if (!USDST) throw new Error("USDST env var required");

  const addrs = {
    ETHST : (process.env.ETHST  || "93fb7295859b2d70199e0a4883b7c320cf874e6c").toLowerCase(),
    WBTCST: (process.env.WBTCST || "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9").toLowerCase(),
    GOLDST: (process.env.GOLDST || "491cdfe98470bfe69b662ab368826dca0fc2f24d").toLowerCase(),
    SILVST: (process.env.SILVST || "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94").toLowerCase(),
  };

  const amounts = {
    ETHST : process.env.AMT_ETHST  || "3858150000000000000",   // 3.85815 ETH
    WBTCST: process.env.AMT_WBTCST || "91590000000000000",     // 0.09159 BTC
    GOLDST: process.env.AMT_GOLDST || "2988870000000000000",   // 2.98887 GOLD
    SILVST: process.env.AMT_SILVST || "269235000000000000000", // 269.235 SILV
  };

  const DEP_USD = process.env.DEPOSIT_USDST || "10000000000000000000000"; // 10 000 * 1e18 = 1e22

  const TOKEN_FACTORY = (process.env.TOKEN_FACTORY || "").toLowerCase();
  if (!TOKEN_FACTORY) throw new Error("TOKEN_FACTORY env var required");

  const headers = { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });

  const cirrusGet = async (table, params) => {
    const url = `${cirrusBase}${table}`;
    // console.log(`cirrusGet: ${url}`);
    const { data } = await axios.get(url, { headers, params });
    // console.log(`cirrusGet data: ${JSON.stringify(data)}`);
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
    const { data } = await axios.post(url, body, { headers });
    if (data[0].status !== "Success") {
      throw new Error(`Contract call failed: ${JSON.stringify(data[0])}`);
    }
    const result = data[0].data.contents[0];
    return result;
  };

  /* ---------------------------------------------------------
     Sanity-check: make sure PoolFactory is wired to the same
     TokenFactory instance we are about to use. If mismatched,
     call setTokenFactory() once to align them so the
     tokensActive() modifier passes.
  --------------------------------------------------------- */
  try {
    const poolFactoryRows = await cirrusGet("/BlockApps-Mercata-PoolFactory", {
      address: `eq.${POOL_FACTORY}`,
      select: "tokenFactory",
      limit: 1,
    });
    
    if (poolFactoryRows.length === 0) {
      throw new Error(`PoolFactory ${POOL_FACTORY} not found in Cirrus`);
    }
    
    const tfAddr = poolFactoryRows[0].tokenFactory;
    const tfCurrent = String(tfAddr).toLowerCase();
    // console.log(`tfCurrent: ${tfCurrent}`);
    if (tfCurrent !== TOKEN_FACTORY) {
      console.log(`\nPoolFactory.tokenFactory mismatch – fixing (was ${tfCurrent}, want ${TOKEN_FACTORY})…`);
      const tx = buildCall("PoolFactory", POOL_FACTORY, "setTokenFactory", { _tokenFactory: TOKEN_FACTORY });
      const { data: res } = await axios.post(`${BASE}/transaction/parallel?resolve=true`, { txs: [tx] }, { headers });
      if (res[0].status !== "Success") {
        throw new Error(`setTokenFactory failed: ${JSON.stringify(res[0])}`);
      }
      console.log("PoolFactory.tokenFactory updated ✔");
    }
  } catch (err) {
    console.warn("! Could not verify / update PoolFactory.tokenFactory:", err.message || err);
  }

  // helper to query cirrus whether pool exists
  const poolExists = async (tokenB) => {
    const path = `/BlockApps-Mercata-Pool`; // pool table name
    const params = {
      poolFactory: `eq.${POOL_FACTORY}`,
      tokenA: `eq.${USDST.toLowerCase()}`,
      tokenB: `eq.${tokenB.toLowerCase()}`,
      select: "address",
      limit: 1,
    };
    try {
      const { data } = await axios.get(`${cirrusBase}${path}`, { headers, params });
      return data.length > 0 ? data[0].address : null;
    } catch (_) {
      return null; // cirrus might fail if table missing – treat as not found
    }
  };

  /* NEW helper ------------ */

  // return the LP token address for a given pool (lower-case)
  const getLpTokenAddr = async (poolAddr) => {
    try {
      return (await callContract("Pool", poolAddr, "lpToken")).toLowerCase();
    } catch (_) {
      return null;
    }
  };

  // detect whether the pool already holds liquidity by checking LP supply > 0
  const poolHasLiquidity = async (poolAddr) => {
    try {
      const lp = await getLpTokenAddr(poolAddr);
      if (!lp) return false;
      const supply = await callContract("Token", lp, "totalSupply");
      return BigInt(supply) > 0n;
    } catch (_) {
      return false;
    }
  };
  /* ------------ end helpers */

  /* ---------------------------------------------------------
     Step 0 – make sure every token is (a) ACTIVE and (b) known
     to the current TokenFactory. We do this once up-front so
     PoolFactory.createPool won't revert with "Token not active".
  --------------------------------------------------------- */
  const allTokens = [USDST, ...Object.values(addrs)];


  console.log("\nEnsuring tokens are ACTIVE and registered in TokenFactory…");

  // 1) setStatus(2) where needed
  for (const token of allTokens) {
    try {
      const rows = await cirrusGet("/BlockApps-Mercata-Token", {
        address: `eq.${token}`,
        select: "status",
        limit: 1,
      });
      const current = rows[0] ? Number(rows[0].status) : 0;
      if (current !== 2) {
        console.log(`  – Activating token ${token} (was ${current})…`);
        const tx = buildCall("Token", token, "setStatus", { newStatus: 2 });
        const { data: res } = await axios.post(txEndpoint, { txs: [tx] }, { headers });
        if (res[0].status !== "Success") throw new Error(res[0].error || res[0].status);
      }
    } catch (err) {
      console.warn(`  ! Could not activate token ${token}:`, err.message || err);
    }
  }

  // 2) registerMigratedTokens to make sure isFactoryToken true
  try {
    console.log("  – Registering tokens in TokenFactory if missing…");
    const tx = buildCall("TokenFactory", TOKEN_FACTORY, "registerMigratedTokens", {
      tokens: allTokens,
    });
    await axios.post(txEndpoint, { txs: [tx] }, { headers });
  } catch (e) {
    console.warn("  ! registerMigratedTokens call ignored (might already be factory tokens)");
  }

  for (const [sym, tokenB] of Object.entries(addrs)) {
    console.log(`\n=== ${sym}/USDST ===`);
    let poolAddr = await poolExists(tokenB);
    if (poolAddr) {
      console.log(`Pool already exists: ${poolAddr}`);
    } else {
      console.log("Creating pool via PoolFactory.createPool…");
      const tx = buildCall("PoolFactory", POOL_FACTORY, "createPool", { tokenA: USDST, tokenB });
      const body = { txs: [tx], txParams: { gasPrice: 1, gasLimit: 32100000000 } };
      const { data: res } = await axios.post(txEndpoint, body, { headers });
      if (res[0].status !== "Success") throw new Error(`createPool failed: ${JSON.stringify(res[0])}`);
      poolAddr = res[0].data.contents[0];
      console.log(`Pool created at ${poolAddr}`);
    }

    // NEW: skip seeding if liquidity already present
    if (await poolHasLiquidity(poolAddr)) {
      console.log("Pool already seeded – skipping liquidity add");
      continue;
    }

    console.log("Seeding liquidity:", DEP_USD / 1e18, "USDST vs", amounts[sym] / 1e18, sym);

    const txs = [
      // approve USDST & tokenB
      buildCall("Token", USDST, "approve", { spender: poolAddr, value: DEP_USD }),
      buildCall("Token", tokenB, "approve", { spender: poolAddr, value: amounts[sym] }),
      // addLiquidity (tokenBAmount, maxTokenAAmount, deadline)
      buildCall("Pool", poolAddr, "addLiquidity", {
        tokenBAmount: amounts[sym],
        maxTokenAAmount: DEP_USD,
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      }),
    ];

    const body = { txs, txParams: { gasPrice: 1, gasLimit: 32100000000 } };
    const { data: res2 } = await axios.post(txEndpoint, body, { headers });
    const failed = res2.findIndex((r) => r.status !== "Success");
    if (failed !== -1) {
      console.error("Liquidity add failed:", JSON.stringify(res2[failed], null, 2));
      throw new Error(`Liquidity add failed for ${sym}`);
    }
    console.log(`Liquidity added ✔ tx hash ${res2[2].hash}`);
  }
})(); 