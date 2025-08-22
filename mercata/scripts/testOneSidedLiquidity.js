// ETH Pool Test: Deploy, add liquidity, swap, withdraw
// Required: ADMIN_TOKEN (JWT), ACC_Y_TOKEN (JWT), USDST, POOL_FACTORY, TOKEN_FACTORY

const { contractCall } = require("./util/contractCall.js");
const TokenContractCall = require("./util/tokenContractCall.js");
const axios = require("axios");
require("dotenv").config();

(async () => {
  // Config - ADMIN_TOKEN and ACC_Y_TOKEN are JWT tokens for the accounts
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const SWAPPER_TOKEN = process.env.SWAPPER_TOKEN;
  const ADMIN_ADDRESS = "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
  const USDST = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
  const ETHST = "93fb7295859b2d70199e0a4883b7c320cf874e6c";
  const POOL_FACTORY = "2d77465d2a2e630cb16e06060cdb05614a945572";
  const TOKEN_FACTORY = "000000000000000000000000000000000000100b";
  const DEADLINE = String(Math.floor(Date.now() / 1000) + 3600);
  
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN JWT required");
  
  // Amounts (ETHST=tokenA, USDST=tokenB)
  const SEED_AMT_ETHST = "3858150000000000000";   // 3.85815 ETHST
  const SEED_AMT_USDST = "10000000000000000000000"; // 10,000 USDST
  const SWAP_AMT = "5000000000000000000";     // 5 tokens
  let POOL_ADDR = "";

  // Cirrus helper for reading on-chain data
  const cirrusGet = async (table, cols, address) => {
    const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
    const headers = { Authorization: `Bearer ${ADMIN_TOKEN}` };
    const { data } = await axios.get(`${ROOT}/cirrus/search${table}`, {
      headers,
      params: { address: `eq.${address}`, select: cols.join(","), limit: 1 }
    });
    return data.length > 0 ? data[0] : null;
  };

  const states = [];
    const recordState = async (label) => {
    console.log(`\n--- ${label} ---`);

    // Get Pool's token balances (tokenABalance, tokenBBalance) and LP token address
    const poolData = await cirrusGet("/Pool", ["tokenABalance", "tokenBBalance", "lpToken"], POOL_ADDR);
    if (!poolData) {
      console.error(`❌ FATAL: Failed to get pool data from Cirrus for ${POOL_ADDR}`);
      process.exit(1);
    }

    const lpToken = poolData.lpToken.toLowerCase();

    // Get ADMIN's LP token balance via balanceOf call
    const adminLpBalance = await new TokenContractCall(lpToken).balanceOf(ADMIN_ADDRESS);
    if (adminLpBalance === null || adminLpBalance === undefined) {
      console.error(`❌ FATAL: Failed to get LP token balance for admin ${ADMIN_ADDRESS}`);
      process.exit(1);
    }

    // Get SWAPPER's LP token balance via balanceOf call
    const SWAPPER_ADDRESS = "c714b751376045eb67d19ad7329dc0003adfd253"; // From the transfer account
    const swapperLpBalance = await new TokenContractCall(lpToken).balanceOf(SWAPPER_ADDRESS, ADMIN_TOKEN);

    // Get actual token balances in the pool contract (what the pool actually holds)
    const poolActualTokenABalance = await new TokenContractCall(ETHST).balanceOf(POOL_ADDR, ADMIN_TOKEN);
    const poolActualTokenBBalance = await new TokenContractCall(USDST).balanceOf(POOL_ADDR, ADMIN_TOKEN);

    const state = {
      label,
      poolTokenABalance: poolData.tokenABalance,
      poolTokenBBalance: poolData.tokenBBalance,
      poolActualTokenABalance: poolActualTokenABalance,
      poolActualTokenBBalance: poolActualTokenBBalance,
      adminLpTokens: adminLpBalance,
      swapperLpTokens: swapperLpBalance || "0"
    };
    states.push(state);
    
    // Display with full numbers (no scientific notation)
    const displayState = {
      label,
      poolTokenABalance: poolData.tokenABalance,
      poolTokenBBalance: poolData.tokenBBalance,
      poolActualTokenABalance: poolActualTokenABalance,
      poolActualTokenBBalance: poolActualTokenBBalance,
      adminLpTokens: adminLpBalance,
      swapperLpTokens: swapperLpBalance || "0"
    };
    console.log(JSON.stringify(displayState, (key, value) => typeof value === 'number' ? value.toString() : value, 2));
  };

  // Helper to check if pool exists via Cirrus
  const poolExists = async (tokenA, tokenB) => {
    try {
      const { data } = await axios.get(`${(process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "")}/cirrus/search/Pool`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        params: {
          _owner: `eq.${POOL_FACTORY}`,
          tokenA: `eq.${tokenA.toLowerCase()}`,
          tokenB: `eq.${tokenB.toLowerCase()}`,
          select: "address",
          limit: 1,
        }
      });
      return data.length > 0 ? data[0].address : null;
    } catch (_) {
      return null; // cirrus might fail if table missing – treat as not found
    }
  };

  console.log(`ETH Pool Test: ${ADMIN_ADDRESS}`);
  
  // Setup tokens following createKeyAssetPools.js pattern
  console.log("\nEnsuring tokens are ACTIVE and registered in TokenFactory…");
  
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const cirrusBase = `${ROOT}/cirrus/search`;
  const headers = { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });
  
  const allTokens = [ETHST, USDST];
  
  // Step 1: Ensure PoolFactory has correct TokenFactory (skip verification to avoid API issues)
  try {
    console.log("  – Setting PoolFactory.tokenFactory to ensure alignment…");
    const setTx = buildCall("PoolFactory", POOL_FACTORY, "setTokenFactory", { _tokenFactory: TOKEN_FACTORY });
    const { data: setRes } = await axios.post(txEndpoint, { txs: [setTx] }, { headers });
    if (setRes[0].status !== "Success") {
      console.warn("  ! setTokenFactory failed (may already be set correctly)");
    } else {
      console.log("PoolFactory.tokenFactory updated ✔");
    }
  } catch (err) {
    console.warn("  ! Could not set PoolFactory.tokenFactory:", err.message || err);
  }

  // Step 2: Activate tokens (setStatus(2) where needed)
  for (const token of allTokens) {
    try {
      const { data } = await axios.get(`${cirrusBase}/BlockApps-Mercata-Token`, {
        headers,
        params: { address: `eq.${token}`, select: "status", limit: 1 }
      });
      const current = data[0] ? Number(data[0].status) : 0;
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

  // Step 3: Register tokens in TokenFactory
  try {
    console.log("  – Registering tokens in TokenFactory if missing…");
    const tx = buildCall("TokenFactory", TOKEN_FACTORY, "registerMigratedTokens", {
      tokens: allTokens,
    });
    await axios.post(txEndpoint, { txs: [tx] }, { headers });
  } catch (e) {
    console.warn("  ! registerMigratedTokens call ignored (might already be factory tokens)");
  }

  // Step 4: Ensure PoolFactory is admin (required for pool creation)
  try {
    console.log("  – Adding PoolFactory as admin…");
    const tx = buildCall("AdminRegistry", "000000000000000000000000000000000000100c", "addAdmin", {
      admin: POOL_FACTORY,
    });
    await axios.post(txEndpoint, { txs: [tx] }, { headers });
    console.log("PoolFactory added as admin ✔");
  } catch (e) {
    console.warn("  ! addAdmin call ignored (PoolFactory may already be admin)");
  }

  // Deploy or find pool (using ADMIN_TOKEN)
  let poolAddr = await poolExists(ETHST, USDST);
  if (poolAddr) {
    POOL_ADDR = poolAddr;
    console.log(`Pool already exists: ${POOL_ADDR}`);
  } else {
    console.log("Creating pool via PoolFactory.createPool…");
    const result = await contractCall("PoolFactory", POOL_FACTORY, "createPool", { tokenA: ETHST, tokenB: USDST }, ADMIN_TOKEN);
    POOL_ADDR = result.data.contents[0].toLowerCase();
    console.log(`Pool created at ${POOL_ADDR}`);
  }

  // Add liquidity (using ADMIN_TOKEN)
  await recordState("Initial");
  console.log("Adding liquidity...");
  await new TokenContractCall(ETHST).approve(POOL_ADDR, SEED_AMT_ETHST, ADMIN_TOKEN);
  await new TokenContractCall(USDST).approve(POOL_ADDR, SEED_AMT_USDST, ADMIN_TOKEN);
  await contractCall("Pool", POOL_ADDR, "addLiquidity", { tokenBAmount: SEED_AMT_USDST, maxTokenAAmount: SEED_AMT_ETHST, deadline: DEADLINE }, ADMIN_TOKEN);
  console.log("Waiting 1 second for Cirrus to update...");
  await new Promise(resolve => setTimeout(resolve, 1000));
  await recordState("After Add Liquidity");

  // One-sided liquidity deposit: SWAPPER adds USDST-only liquidity
  const SWAPPER_ADDRESS = "c714b751376045eb67d19ad7329dc0003adfd253";
  const SINGLE_TOKEN_AMT = "1234567890000000000000"; // 1234.56789 USDST
  console.log(`SWAPPER (${SWAPPER_ADDRESS}) adding ${SINGLE_TOKEN_AMT} USDST as one-sided liquidity...`);
  await new TokenContractCall(USDST).approve(POOL_ADDR, SINGLE_TOKEN_AMT, SWAPPER_TOKEN);
  await contractCall("Pool", POOL_ADDR, "addLiquiditySingleToken", { 
    isAToB: false,  // false = depositing tokenB (USDST) only
    amountIn: SINGLE_TOKEN_AMT, 
    deadline: DEADLINE 
  }, SWAPPER_TOKEN);
  console.log("Waiting 1 second for Cirrus to update...");
  await new Promise(resolve => setTimeout(resolve, 1000));
  await recordState("After One-Sided Liquidity");

  // Swap (using SWAPPER_TOKEN) - Swap USDST for ETHST since swapper has USDST
  console.log("Swapping 5000 USDST for ETHST...");
  await new TokenContractCall(USDST).approve(POOL_ADDR, SWAP_AMT, SWAPPER_TOKEN);
  await contractCall("Pool", POOL_ADDR, "swap", { isAToB: false, amountIn: SWAP_AMT, minAmountOut: "1", deadline: DEADLINE }, SWAPPER_TOKEN);
  console.log("Waiting 1 second for Cirrus to update...");
  await new Promise(resolve => setTimeout(resolve, 1000));
  await recordState("After Swap");

  // Remove liquidity (using ADMIN_TOKEN)
  console.log("Removing liquidity...");
  const poolData = await cirrusGet("/Pool", ["lpToken"], POOL_ADDR);
  const lpToken = poolData ? poolData.lpToken.toLowerCase() : "PLACEHOLDER_LP_TOKEN";
  const lpBalance = await new TokenContractCall(lpToken).balanceOf(ADMIN_ADDRESS, ADMIN_TOKEN);
  
  await new TokenContractCall(lpToken).approve(POOL_ADDR, lpBalance, ADMIN_TOKEN);
  await contractCall("Pool", POOL_ADDR, "removeLiquidity", { lpTokenAmount: lpBalance, minTokenBAmount: "1", minTokenAAmount: "1", deadline: DEADLINE }, ADMIN_TOKEN);
  console.log("Waiting 1 second for Cirrus to update...");
  await new Promise(resolve => setTimeout(resolve, 1000));
  await recordState("After Remove Liquidity");

  console.log("\n=== FINAL STATES ===");
  console.log(JSON.stringify(states, (key, value) => typeof value === 'number' ? value.toString() : value, 2));

})();
