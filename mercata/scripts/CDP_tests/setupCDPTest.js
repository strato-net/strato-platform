// CDP Test Setup: Deploy, configure, and test liquidation scenario
// Required: ADMIN_TOKEN (JWT), LIQUIDATOR_TOKEN (JWT), CDP contract addresses in .env

const axios = require("axios");
require("dotenv").config();

(async () => {
  // Config - Tokens are JWT tokens for the accounts
  const ACC1_TOKEN = process.env.ACC1_TOKEN;
  const ACC2_TOKEN = process.env.ACC2_TOKEN;
  const ACC1_ADDRESS = process.env.ACC1_ADDRESS || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
  const ACC2_ADDRESS = process.env.ACC2_ADDRESS;
  
  // Contract addresses from .env
  const USDST = process.env.USDST || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
  const ETHST = process.env.ETHST || "93fb7295859b2d70199e0a4883b7c320cf874e6c";
  const CDP_ENGINE = process.env.CDP_ENGINE;
  const CDP_VAULT = process.env.CDP_VAULT;
  const CDP_REGISTRY = process.env.CDP_REGISTRY;
  const CDP_RESERVE = process.env.CDP_RESERVE;
  const PRICE_ORACLE = process.env.PRICE_ORACLE;
  const ADMIN_REGISTRY = process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c";
  const TOKEN_FACTORY = process.env.TOKEN_FACTORY || "000000000000000000000000000000000000100b";

  if (!ACC1_TOKEN) throw new Error("ACC1_TOKEN (ADMIN_TOKEN) JWT required");
  if (!ACC2_TOKEN) throw new Error("ACC2_TOKEN (LIQUIDATOR_TOKEN) JWT required");
  if (!CDP_ENGINE) throw new Error("CDP_ENGINE address required in .env");
  if (!CDP_VAULT) throw new Error("CDP_VAULT address required in .env");
  if (!PRICE_ORACLE) throw new Error("PRICE_ORACLE address required in .env");
  if (!TOKEN_FACTORY) throw new Error("TOKEN_FACTORY address required in .env");

  // Test amounts - clean numbers to avoid precision issues
  const LARGE_APPROVAL = "1000000000000000000000000000"; // 1 billion USDST (keep large for approval)
  const ETHST_DEPOSIT = "10000000000000000000";          // 10 ETHST (round number)
  const USDST_MINT = "15000000000000000000000";          // 15,000 USDST (safe under 150% LR)
  const INITIAL_ETHST_PRICE = "3000000000000000000000";   // $3,000 (18 decimals: 3000 * 1e18)
  const CRASH_ETHST_PRICE = "100000000000000000000";     // $100 (18 decimals: 100 * 1e18)
  const LIQUIDATION_AMOUNT = "50000000000000000000000";   // 50,000 USDST (much larger than debt)

  // API setup - Following testNewPool.js pattern exactly
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const cirrusBase = `${ROOT}/cirrus/search`;
  const headers = { Authorization: `Bearer ${ACC1_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });

  // Cirrus helper for reading on-chain data
  const cirrusGet = async (table, cols, address, token = ACC1_TOKEN) => {
    const cirrusHeaders = { Authorization: `Bearer ${token}` };
    const { data } = await axios.get(`${ROOT}/cirrus/search${table}`, {
      headers: cirrusHeaders,
      params: { address: `eq.${address}`, select: cols.join(","), limit: 1 }
    });
    return data.length > 0 ? data[0] : null;
  };

  // ETHST collateral configuration - PLACEHOLDER for actual parameters
  const ETHST_CONFIG = {
    liquidationRatio: "1500000000000000000",      // 150% (1.5 * 1e18)
    liquidationPenaltyBps: "500",                 // 5% penalty (minimum allowed)
    closeFactorBps: "10000",                      // 100% close factor
    stabilityFeeRate: "1000000000315522921573372069", // ~1% APR
    debtFloor: "1000000000000000000",           // 1 USDST minimum
    debtCeiling: "1000000000000000000000000000000000",     // 1,0000,000,000,000,000 USDST ceiling
    unitScale: "1000000000000000000",             // 1e18 (ETHST has 18 decimals)
    pause: false
  };

  console.log(`🚀 CDP Test Setup Starting...`);
  console.log(`Acc1: ${ACC1_ADDRESS}`);
  console.log(`Acc2: ${ACC2_ADDRESS}`);
  console.log(`CDP Engine: ${CDP_ENGINE}`);

  try {


    
    // Step 0: Initial state check - balances and bad debt
    console.log("\n🔍 Step 0: Initial state check...");
    
    // Check acc1 USDST balance
    const balanceTx = buildCall("Token", USDST, "balanceOf", { accountAddress: ACC1_ADDRESS });
    const { data: balanceRes } = await axios.post(txEndpoint, { txs: [balanceTx] }, { headers });
    if (balanceRes[0].status !== "Success") {
      throw new Error(`Failed to get balance: ${balanceRes[0].error || balanceRes[0].status}`);
    }
    const currentBalance = balanceRes[0].data?.contents?.[0] || "0";
    console.log(`✅ Acc1 USDST balance: ${currentBalance}`);
    
    // Check CDP Reserve balance
    const reserveBalanceTx = buildCall("Token", USDST, "balanceOf", { accountAddress: CDP_RESERVE });
    const { data: reserveBalanceRes } = await axios.post(txEndpoint, { txs: [reserveBalanceTx] }, { headers });
    const initialReserveBalance = reserveBalanceRes[0].data?.contents?.[0] || "0";
    console.log(`💰 Initial CDP Reserve balance: ${initialReserveBalance} USDST`);
    
    // Check initial bad debt via Cirrus
    console.log(`🔍 Checking initial bad debt via Cirrus...`);
    let initialBadDebt = "0";
    let initialBadDebtRaw = null;
    try {
      // Fetch bad debt data from Cirrus - returns array format
      const { data } = await axios.get(`${ROOT}/cirrus/search/CDPEngine-badDebtUSD`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { address: `eq.${CDP_ENGINE}`, select: "*", limit: 100 }
      });
      initialBadDebtRaw = data;
      
      if (data && data.length > 0) {
        // Extract bad debt values from the array and sum them up
        let totalBadDebt = 0;
        for (const entry of data) {
          if (entry.value && typeof entry.value === 'object') {
            // Assuming the bad debt value is stored directly or in a specific field
            const debtValue = entry.value.badDebtUSD || entry.value;
            if (typeof debtValue === 'string' || typeof debtValue === 'number') {
              totalBadDebt += Number(debtValue);
            }
          }
        }
        initialBadDebt = totalBadDebt.toString();
        console.log(`📊 Initial bad debt: ${initialBadDebt} (${data.length} entries)`);
      } else {
        console.log(`📊 Initial bad debt: 0 (no entries found)`);
      }
    } catch (error) {
      console.warn("⚠️  Could not fetch bad debt from Cirrus:", error.message);
      console.log(`📊 Initial bad debt: 0 (fallback due to error)`);
    }




    // Step 1: Approve CDP Vault for large amount of USDST
    console.log("\n📝 Step 1: Approving CDP Vault for USDST...");
    const approveTx = buildCall("Token", USDST, "approve", { spender: CDP_VAULT, value: LARGE_APPROVAL });
    const { data: approveRes } = await axios.post(txEndpoint, { txs: [approveTx] }, { headers });
    if (approveRes[0].status !== "Success") {
      throw new Error(`Failed to approve: ${approveRes[0].error || approveRes[0].status}`);
    }
    console.log(`✅ Approved ${LARGE_APPROVAL} USDST for CDP Vault`);




    // Step 2: Give CDPEngine mint/burn rights on USDST
    console.log("\n🔑 Step 2: Granting CDPEngine mint/burn rights on USDST...");
    
    // First, whitelist CDPEngine for mint function
    try {
      const mintWhitelistTx = buildCall("Token", USDST, "addWhitelist", {
        _admin: ADMIN_REGISTRY,
        _func: "mint",
        _accountToWhitelsit: CDP_ENGINE
      });
      const { data: mintRes } = await axios.post(txEndpoint, { txs: [mintWhitelistTx] }, { headers });
      if (mintRes[0].status !== "Success") {
        console.warn("⚠️  Mint whitelist may have failed (might already be set):", mintRes[0].error || mintRes[0].status);
      } else {
        console.log("✅ CDPEngine granted mint rights on USDST");
      }
    } catch (error) {
      console.warn("⚠️  Mint whitelist may have failed (might already be set):", error.message);
    }
    
    // Then, whitelist CDPEngine for burn function  
    try {
      const burnWhitelistTx = buildCall("Token", USDST, "addWhitelist", {
        _admin: ADMIN_REGISTRY,
        _func: "burn", 
        _accountToWhitelsit: CDP_ENGINE
      });
      const { data: burnRes } = await axios.post(txEndpoint, { txs: [burnWhitelistTx] }, { headers });
      if (burnRes[0].status !== "Success") {
        console.warn("⚠️  Burn whitelist may have failed (might already be set):", burnRes[0].error || burnRes[0].status);
      } else {
        console.log("✅ CDPEngine granted burn rights on USDST");
      }
    } catch (error) {
      console.warn("⚠️  Burn whitelist may have failed (might already be set):", error.message);
    }

    // Step 2.5: Set TokenFactory in CDPRegistry
    // console.log("\n🔧 Step 2.5: Setting TokenFactory in CDPRegistry...");
    // const setTokenFactoryTx = buildCall("CDPRegistry", CDP_REGISTRY, "setTokenFactory", {
    //   _tokenFactory: TOKEN_FACTORY
    // });
    // const { data: setTokenFactoryRes } = await axios.post(txEndpoint, { txs: [setTokenFactoryTx] }, { headers });
    // if (setTokenFactoryRes[0].status !== "Success") {
    //   console.warn("⚠️  Failed to set TokenFactory (may already be set):", setTokenFactoryRes[0].error || setTokenFactoryRes[0].status);
    // } else {
    //   console.log("✅ TokenFactory set in CDPRegistry");
    // }

    // Step 3: Configure ETHST as collateral asset
    console.log("\n⚙️  Step 3: Configuring ETHST as collateral in CDPEngine...");
    const configTx = buildCall("CDPEngine", CDP_ENGINE, "setCollateralAssetParams", {
      asset: ETHST,
      liquidationRatio: ETHST_CONFIG.liquidationRatio,
      liquidationPenaltyBps: ETHST_CONFIG.liquidationPenaltyBps,
      closeFactorBps: ETHST_CONFIG.closeFactorBps,
      stabilityFeeRate: ETHST_CONFIG.stabilityFeeRate,
      debtFloor: ETHST_CONFIG.debtFloor,
      debtCeiling: ETHST_CONFIG.debtCeiling,
      unitScale: ETHST_CONFIG.unitScale,
      pause: ETHST_CONFIG.pause
    });
    const { data: configRes } = await axios.post(txEndpoint, { txs: [configTx] }, { headers });
    if (configRes[0].status !== "Success") {
      throw new Error(`Failed to configure ETHST: ${configRes[0].error || configRes[0].status}`);
    }
    console.log("✅ ETHST configured as collateral asset");





    // Step 4: Set ETHST price to $3,000
    console.log("\n💰 Step 4: Setting ETHST price to $3,000...");
    const setPriceTx = buildCall("PriceOracle", PRICE_ORACLE, "setAssetPrice", {
      asset: ETHST,
      price: INITIAL_ETHST_PRICE
    });
    const { data: setPriceRes } = await axios.post(txEndpoint, { txs: [setPriceTx] }, { headers });
    if (setPriceRes[0].status !== "Success") {
      throw new Error(`Failed to set price: ${setPriceRes[0].error || setPriceRes[0].status}`);
    }
    console.log("✅ ETHST price set to $3,000");





    // Step 5: Deposit 10 ETHST as collateral
    console.log("\n🏦 Step 5: Depositing 10 ETHST as collateral...");
    
    // First approve ETHST for CDP Vault
    const approveETHSTTx = buildCall("Token", ETHST, "approve", { spender: CDP_VAULT, value: ETHST_DEPOSIT });
    const { data: approveETHSTRes } = await axios.post(txEndpoint, { txs: [approveETHSTTx] }, { headers });
    if (approveETHSTRes[0].status !== "Success") {
      throw new Error(`Failed to approve ETHST: ${approveETHSTRes[0].error || approveETHSTRes[0].status}`);
    }
    
    // Then deposit via CDPEngine
    const depositTx = buildCall("CDPEngine", CDP_ENGINE, "deposit", {
      asset: ETHST,
      amount: ETHST_DEPOSIT
    });
    const { data: depositRes } = await axios.post(txEndpoint, { txs: [depositTx] }, { headers });
    if (depositRes[0].status !== "Success") {
      throw new Error(`Failed to deposit: ${depositRes[0].error || depositRes[0].status}`);
    }
    console.log(`✅ Deposited ${ETHST_DEPOSIT} ETHST as collateral`);

    



    // Step 6: Mint 15,000 USDST against ETHST
    console.log("\n🪙 Step 6: Minting 15,000 USDST...");
    console.log(`Attempting to mint ${USDST_MINT} USDST against ${ETHST_DEPOSIT} ETHST collateral`);
    
    const mintTx = buildCall("CDPEngine", CDP_ENGINE, "mint", {
      asset: ETHST,
      amountUSD: USDST_MINT
    });
    
    try {
      const { data: mintRes } = await axios.post(txEndpoint, { txs: [mintTx] }, { headers });
      if (mintRes[0].status !== "Success") {
        console.error("❌ Mint transaction failed:");
        console.error("Status:", mintRes[0].status);
        console.error("Error:", mintRes[0].error);
        console.error("Full response:", JSON.stringify(mintRes[0], null, 2));
        throw new Error(`Failed to mint: ${mintRes[0].error || mintRes[0].status}`);
      }
      console.log(`✅ Minted ${USDST_MINT} USDST`);
    } catch (error) {
      console.error("❌ Mint request failed:");
      console.error("Error message:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }

    // Brief delay to allow blockchain state to sync
    // console.log("⏳ Waiting for blockchain state sync...");
    // await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

    // Check position health
    console.log("\n📊 Checking position health...");
    try {
      const checkBalanceTx = buildCall("Token", USDST, "balanceOf", { accountAddress: ACC1_ADDRESS });
      const { data: checkBalanceRes } = await axios.post(txEndpoint, { txs: [checkBalanceTx] }, { headers });
      
      if (checkBalanceRes[0].status !== "Success") {
        console.warn("⚠️  Balance check failed:", checkBalanceRes[0].error || checkBalanceRes[0].status);
        console.log("Continuing anyway...");
      } else {
        const adminUSDSTBalance = checkBalanceRes[0].data?.contents?.[0] || "0";
        console.log(`Admin USDST balance: ${adminUSDSTBalance}`);
      }
    } catch (error) {
      console.warn("⚠️  Balance check failed:", error.message);
      console.log("Continuing anyway...");
    }





    // Step 7: Crash ETHST price to $100
    console.log("\n📉 Step 7: Crashing ETHST price to $100...");
    const crashPriceTx = buildCall("PriceOracle", PRICE_ORACLE, "setAssetPrice", {
      asset: ETHST,
      price: CRASH_ETHST_PRICE
    });
    const { data: crashPriceRes } = await axios.post(txEndpoint, { txs: [crashPriceTx] }, { headers });
    if (crashPriceRes[0].status !== "Success") {
      throw new Error(`Failed to crash price: ${crashPriceRes[0].error || crashPriceRes[0].status}`);
    }
    console.log("✅ ETHST price crashed to $100 - position is underwater!");





    // Step 8: Liquidate the position
    console.log("\n⚡ Step 8: Liquidating position...");
    
    // Acc2 needs USDST to perform liquidation - transfer some
    console.log("Transferring USDST to acc2...");
    try {
      const transferTx = buildCall("Token", USDST, "transfer", {
        to: ACC2_ADDRESS,
        value: LIQUIDATION_AMOUNT
      });
      const { data: transferRes } = await axios.post(txEndpoint, { txs: [transferTx] }, { headers });
      if (transferRes[0].status !== "Success") {
        console.warn("⚠️  Failed to transfer USDST to acc2:", transferRes[0].error || transferRes[0].status);
      } else {
        console.log("✅ Transferred USDST to acc2");
      }
    } catch (error) {
      console.warn("⚠️  Failed to transfer USDST to acc2 - acc2 may need USDST:", error.message);
    }

    // Perform liquidation using acc2 account
    const liquidateHeaders = { Authorization: `Bearer ${ACC2_TOKEN}`, "Content-Type": "application/json" };
    const liquidateTx = buildCall("CDPEngine", CDP_ENGINE, "liquidate", {
      collateralAsset: ETHST,
      borrower: ACC1_ADDRESS,
      debtToCover: LIQUIDATION_AMOUNT
    });
    const { data: liquidateRes } = await axios.post(txEndpoint, { txs: [liquidateTx] }, { headers: liquidateHeaders });
    if (liquidateRes[0].status !== "Success") {
      throw new Error(`Failed to liquidate: ${liquidateRes[0].error || liquidateRes[0].status}`);
    }
    console.log("✅ Position liquidated successfully!");

    // Step 9: Second liquidation to clean up remaining dust
    console.log("\n🧹 Step 9: Cleaning up dust position to trigger bad debt...");
    
    try {
      const secondLiquidateHeaders = { Authorization: `Bearer ${ACC2_TOKEN}`, "Content-Type": "application/json" };
      const dustCleanupTx = buildCall("CDPEngine", CDP_ENGINE, "cleanupDustPosition", {
        borrower: ACC1_ADDRESS,
        collateralAsset: ETHST
      });
      const { data: dustCleanupRes } = await axios.post(txEndpoint, { txs: [dustCleanupTx] }, { headers: secondLiquidateHeaders });
      if (dustCleanupRes[0].status !== "Success") {
        console.warn("⚠️  Dust cleanup failed:", dustCleanupRes[0].error || dustCleanupRes[0].status);
      } else {
        console.log("✅ Dust position cleaned up - bad debt should be realized!");
      }
    } catch (error) {
      console.warn("⚠️  Dust cleanup failed:", error.message);
    }





    // Final status check
    console.log("\n📈 Final Status Check...");
    
    // Check final balances
    const finalUSDSTTx = buildCall("Token", USDST, "balanceOf", { accountAddress: ACC1_ADDRESS });
    const { data: finalUSDSTRes } = await axios.post(txEndpoint, { txs: [finalUSDSTTx] }, { headers });
    const finalUSDSTBalance = finalUSDSTRes[0].data?.contents?.[0] || "0";
    
    const acc2Headers = { Authorization: `Bearer ${ACC2_TOKEN}`, "Content-Type": "application/json" };
    const acc2ETHSTTx = buildCall("Token", ETHST, "balanceOf", { accountAddress: ACC2_ADDRESS });
    const { data: acc2ETHSTRes } = await axios.post(txEndpoint, { txs: [acc2ETHSTTx] }, { headers: acc2Headers });
    const acc2ETHSTBalance = acc2ETHSTRes[0].data?.contents?.[0] || "0";
    
    // Check final CDP Reserve balance
    const finalReserveBalanceTx = buildCall("Token", USDST, "balanceOf", { accountAddress: CDP_RESERVE });
    const { data: finalReserveBalanceRes } = await axios.post(txEndpoint, { txs: [finalReserveBalanceTx] }, { headers });
    const finalReserveBalance = finalReserveBalanceRes[0].data?.contents?.[0] || "0";
    
    // Check final bad debt via Cirrus
    let finalBadDebt = "0";
    let finalBadDebtRaw = null;
    try {
      // Fetch final bad debt data from Cirrus - returns array format
      const { data } = await axios.get(`${ROOT}/cirrus/search/CDPEngine-badDebtUSD`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { address: `eq.${CDP_ENGINE}`, select: "*", limit: 100 }
      });
      finalBadDebtRaw = data;
      
      if (data && data.length > 0) {
        // Extract bad debt values from the array and sum them up
        let totalBadDebt = 0;
        for (const entry of data) {
          if (entry.value && typeof entry.value === 'object') {
            // Assuming the bad debt value is stored directly or in a specific field
            const debtValue = entry.value.badDebtUSD || entry.value;
            if (typeof debtValue === 'string' || typeof debtValue === 'number') {
              totalBadDebt += Number(debtValue);
            }
          }
        }
        finalBadDebt = totalBadDebt.toString();
        console.log(`📊 Final bad debt: ${finalBadDebt} (${data.length} entries)`);
      } else {
        console.log(`📊 Final bad debt: 0 (no entries found)`);
      }
    } catch (error) {
      console.warn("⚠️  Could not fetch final bad debt from Cirrus:", error.message);
      console.log(`📊 Final bad debt: 0 (fallback due to error)`);
    }
    
    console.log(`👤 Acc1 final USDST balance: ${finalUSDSTBalance}`);
    console.log(`⚡ Acc2 ETHST received: ${acc2ETHSTBalance}`);
    console.log(`💰 CDP Reserve balance: ${initialReserveBalance} → ${finalReserveBalance} USDST`);
    console.log(`📊 Bad debt: ${initialBadDebt} → ${finalBadDebt}`);

    console.log("\n🎉 CDP Test Setup Complete!");
    console.log("Summary:");
    console.log(`- Deposited: ${ETHST_DEPOSIT} ETHST (~$30,000 at $3,000)`);
    console.log(`- Minted: ${USDST_MINT} USDST`);
    console.log(`- Price crashed from $3,000 to $100`);
    console.log(`- Collateral value after crash: $1,000 (underwater!)`);
    console.log(`- Position liquidated for ${LIQUIDATION_AMOUNT} USDST`);
    console.log(`- Acc2 received ETHST collateral`);
    console.log(`- Reserve balance change: ${finalReserveBalance !== initialReserveBalance ? 'CHANGED' : 'NO CHANGE'}`);
    console.log(`- Bad debt change: ${finalBadDebt !== initialBadDebt ? 'CHANGED' : 'NO CHANGE'}`);

  } catch (error) {
    console.error("❌ Error during CDP test setup:", error.message || error);
    process.exit(1);
  }
})();
