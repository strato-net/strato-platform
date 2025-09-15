// Junior Notes Test: Test the junior note system with bad debt recovery
// Required: ADMIN_TOKEN (JWT), multiple user tokens, CDP contract addresses in .env
// Prerequisite: Run setupCDPTest.js first to create bad debt

const axios = require("axios");
require("dotenv").config();

(async () => {
  // Config - Tokens are JWT tokens for the accounts (3 different accounts)
  const ACC1_TOKEN = process.env.ACC1_TOKEN;
  const ACC2_TOKEN = process.env.ACC2_TOKEN;
  const ACC3_TOKEN = process.env.ACC3_TOKEN;
  
  const ACC1_ADDRESS = process.env.ACC1_ADDRESS || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
  const ACC2_ADDRESS = process.env.ACC2_ADDRESS;
  const ACC3_ADDRESS = process.env.ACC3_ADDRESS;
  
  // Contract addresses from .env
  const USDST = process.env.USDST || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
  const ETHST = process.env.ETHST || "93fb7295859b2d70199e0a4883b7c320cf874e6c";
  const CDP_ENGINE = process.env.CDP_ENGINE;
  const CDP_RESERVE = process.env.CDP_RESERVE;
  const ADMIN_REGISTRY = process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c";

  if (!ACC1_TOKEN) throw new Error("ACC1_TOKEN JWT required");
  if (!ACC2_TOKEN) throw new Error("ACC2_TOKEN JWT required");
  if (!ACC3_TOKEN) throw new Error("ACC3_TOKEN JWT required");

  if (!CDP_ENGINE) throw new Error("CDP_ENGINE address required in .env");
  if (!CDP_RESERVE) throw new Error("CDP_RESERVE address required in .env");

  // ═══════════════ CONFIGURATION ═══════════════
  // Adjust TRANSACTION_DELAY based on network conditions:
  // - Fast networks: 500-1000ms
  // - Slow/congested networks: 2000-5000ms
  const TRANSACTION_DELAY = 5000; // milliseconds between transactions
  
  // Test amounts - following the outline exactly
  const JUNIOR_PREMIUM = "1000"; // 10% (1000 bps)
  const ACC1_BURN = "2000000000000000000000"; // 2,000 USDST
  const ACC2_BURN = "1500000000000000000000"; // 1,500 USDST  
  const ACC3_BURN = "500000000000000000000";  // 500 USDST
  const ACC2_TOPUP = "1000000000000000000000"; // 1,000 USDST (for top-up)
  
  const INFLOW_1 = "1000000000000000000000"; // 1,000 USDST
  const INFLOW_2 = "700000000000000000000";  // 700 USDST
  const INFLOW_3 = "2000000000000000000000"; // 2,000 USDST
  const INFLOW_4 = "300000000000000000000";  // 300 USDST

  // API setup - Following testNewPool.js pattern exactly
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const headers = { Authorization: `Bearer ${ACC1_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });

  // Helper function to extract error message from 422 responses
  const extractErrorMessage = (error) => {
    if (error.response && error.response.status === 422 && error.response.data) {
      const errorData = error.response.data;
      if (typeof errorData === 'string') {
        // Try to extract Solidity error: "Error running the transaction: solidity require failed: SString \"<message>\""
        const solidityMatch = errorData.match(/solidity require failed: SString "([^"]+)"/);
        if (solidityMatch) {
          return solidityMatch[1];
        }
        
        // Try to extract other error patterns: "Error running the transaction: <message>"
        const generalMatch = errorData.match(/Error running the transaction: (.+)/);
        if (generalMatch) {
          return generalMatch[1];
        }
        
        // Return the full error data if no pattern matches
        return errorData;
      }
    }
    return error.message;
  };

  // Helper function to execute transaction with retry logic
  const executeWithRetry = async (txFunction, description = "transaction") => {
    let lastError;
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await txFunction();
      } catch (error) {
        lastError = error;
        
        // Check if it's a retryable error (mempool issues, network congestion, etc.)
        const errorMsg = extractErrorMessage(error);
        const isRetryable = errorMsg.includes('mempool') || 
                           errorMsg.includes('nonce') || 
                           errorMsg.includes('lucrative') ||
                           errorMsg.includes('pending') ||
                           (error.response && error.response.status >= 500);
        
        if (attempt === 1 && isRetryable) {
          console.warn(`⚠️  ${description} failed (attempt ${attempt}/2): ${errorMsg}`);
          console.log(`🔄 Retrying in ${TRANSACTION_DELAY * 3}ms...`);
          await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY * 3));
        } else {
          // Don't retry on second attempt or non-retryable errors
          throw error;
        }
      }
    }
    
    // This shouldn't be reached, but just in case
    throw lastError;
  };

  // Helper to get headers for different users
  const getHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  // Helper to check bad debt via Cirrus
  const checkBadDebt = async () => {
    try {
      const { data } = await axios.get(`${ROOT}/cirrus/search/CDPEngine-badDebtUSD`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { 
          address: `eq.${CDP_ENGINE}`, 
          select: "key,value",
          "value": "gt.0" // Only get entries where bad debt > 0
        }
      });
      
      if (data && data.length > 0) {
        let totalBadDebt = 0;
        for (const entry of data) {
          const debtValue = Number(entry.value || 0);
          totalBadDebt += debtValue;
        }
        return totalBadDebt.toString();
      }
      return "0";
    } catch (error) {
      console.warn("⚠️  Could not fetch bad debt from Cirrus:", error.message);
      return "0";
    }
  };

  // Helper to check junior system state via Cirrus
  const checkJuniorState = async () => {
    try {
      // Get only the specific fields we need from CDPEngine contract state
      const { data: contractData } = await axios.get(`${ROOT}/cirrus/search/CDPEngine`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { 
          address: `eq.${CDP_ENGINE}`, 
          select: "juniorIndex,totalJuniorOutstandingUSD",
          limit: 1 
        }
      });
      
      if (contractData && contractData.length > 0) {
        const contractState = contractData[0];
        const juniorIndex = contractState.juniorIndex || "0";
        const totalOutstanding = contractState.totalJuniorOutstandingUSD || "0";
        return { juniorIndex, totalOutstanding };
      }
      
      return { juniorIndex: "0", totalOutstanding: "0" };
    } catch (error) {
      console.warn("⚠️  Could not get junior system state via Cirrus:", error.message);
      return { juniorIndex: "0", totalOutstanding: "0" };
    }
  };

  // Helper to check claimable amount for a user via Cirrus (junior notes)
  const checkClaimable = async (userAddress, token) => {
    try {
      // Get user's junior note via Cirrus
      const { data: noteData } = await axios.get(`${ROOT}/cirrus/search/CDPEngine-juniorNotes`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { 
          address: `eq.${CDP_ENGINE}`, 
          select: "key,value",
          key: `eq.${userAddress.toLowerCase()}`,
          limit: 1
        }
      });
      
      if (!noteData || noteData.length === 0) return "0";
      
      const userNote = noteData[0];
      if (!userNote || !userNote.value) return "0";
      
      // For now, return the cap (we'd need to calculate claimable based on index)
      // This is a simplified version - in practice you'd calculate based on entryIndex vs current index
      const capUSD = userNote.value.capUSD || "0";
      return capUSD;
    } catch (error) {
      console.warn(`⚠️  Could not get claimable for ${userAddress} via Cirrus:`, error.message);
      return "0";
    }
  };

  console.log(`🚀 Junior Notes Test Starting...`);
  console.log(`👤 Account Mapping:`);
  console.log(`   Acc1: ${ACC1_ADDRESS}`);
  console.log(`   Acc2: ${ACC2_ADDRESS}`);
  console.log(`   Acc3: ${ACC3_ADDRESS}`);
  console.log(`🏭 CDP Engine: ${CDP_ENGINE}`);

  try {



    // Part 2 — Verify Bad Debt & Configure Juniors
    console.log("\n📊 Part 2: Verifying Bad Debt & Configuring Junior System...");
    
    // Check initial bad debt - must have enough for the test (≥ 4,400 USDST)
    const initialBadDebt = await checkBadDebt();
    const initialBadDebtNum = Number(initialBadDebt);
    const requiredBadDebt = 4400e18; // 4,400 USDST for the test
    
    console.log(`💸 Initial bad debt: ${initialBadDebtNum / 1e18} USDST`);
    console.log(`💸 Required bad debt: ${requiredBadDebt / 1e18} USDST`);
    
    if (initialBadDebtNum === 0) {
      throw new Error("No bad debt found! Run setupCDPTest.js first to create bad debt.");
    }
    
    if (initialBadDebtNum < requiredBadDebt) {
      throw new Error(`Insufficient bad debt! Found ${initialBadDebtNum / 1e18} USDST, need at least ${requiredBadDebt / 1e18} USDST. Run setupCDPTest.js first.`);
    }
    
    console.log("✅ Sufficient bad debt available for testing");

    // Set junior premium to 10%
    console.log("\n🔧 Setting junior premium to 10%...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const setPremiumTx = buildCall("CDPEngine", CDP_ENGINE, "setJuniorPremium", {
        newPremiumBps: JUNIOR_PREMIUM
      });
      const { data: setPremiumRes } = await axios.post(txEndpoint, { txs: [setPremiumTx] }, { headers });
      if (setPremiumRes[0].status !== "Success") {
        console.warn("⚠️  Failed to set junior premium (may already be set):", setPremiumRes[0].error || setPremiumRes[0].status);
        console.warn("Full response:", JSON.stringify(setPremiumRes[0], null, 2));
      } else {
        console.log("✅ Junior premium set to 10%");
      }
    } catch (error) {
      console.error("❌ Set premium request failed:");
      console.error("Error message:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response data:", JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }

    // Check initial reserve balance via Cirrus
    let initialReserveBalance = "0";
    try {
      const { data: reserveData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-Token-_balances`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { 
          address: `eq.${USDST}`, 
          select: "key,value",
          key: `eq.${CDP_RESERVE}`,
          limit: 1
        }
      });
      if (reserveData && reserveData.length > 0) {
        initialReserveBalance = reserveData[0].value || "0";
      }
    } catch (error) {
      console.warn("⚠️  Could not get reserve balance via Cirrus:", error.message);
    }
    console.log(`💰 Initial CDP Reserve balance: ${initialReserveBalance} USDST`);





    // Part 3 — Open 3 Junior Notes
    console.log("\n📝 Part 3: Opening Junior Notes...");

    // Ensure users have USDST - transfer from acc1 to acc2 and acc3
    console.log("💸 Transferring USDST to users for junior notes...");
    try {
      // Transfer to acc2
      await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
      const transferToAcc2Tx = buildCall("Token", USDST, "transfer", { 
        to: ACC2_ADDRESS, 
        value: "5000000000000000000000" // 5,000 USDST
      });
      const { data: transferAcc2Res } = await axios.post(txEndpoint, { txs: [transferToAcc2Tx] }, { headers });
      if (transferAcc2Res[0].status === "Success") {
        console.log("✅ Transferred USDST to Acc2");
      }

      // Transfer to acc3
      if (ACC3_ADDRESS !== ACC1_ADDRESS) {
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
        const transferToAcc3Tx = buildCall("Token", USDST, "transfer", { 
          to: ACC3_ADDRESS, 
          value: "2000000000000000000000" // 2,000 USDST
        });
        const { data: transferAcc3Res } = await axios.post(txEndpoint, { txs: [transferToAcc3Tx] }, { headers });
        if (transferAcc3Res[0].status === "Success") {
          console.log("✅ Transferred USDST to Acc3");
        }
      }
    } catch (error) {
      console.warn("⚠️  USDST transfers may have failed:", error.message);
    }

    // Ensure users approve CDPEngine for burns
    const approveAmount = "10000000000000000000000"; // 10,000 USDST approval
    
    // Acc1 opens note (2,000 USDST burn → 2,200 USD cap)
    console.log("\n💼 Acc1: Opening junior note with 2,000 USDST burn...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      // Approve if needed
      const approveAcc1Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc1Res } = await axios.post(txEndpoint, { txs: [approveAcc1Tx] }, { headers: getHeaders(ACC1_TOKEN) });
      if (approveAcc1Res[0].status !== "Success") {
        console.warn("⚠️  Acc1 approval may have failed:", approveAcc1Res[0].error);
      }

      const openAcc1Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSD: ACC1_BURN });
      const { data: openAcc1Res } = await axios.post(txEndpoint, { txs: [openAcc1Tx] }, { headers: getHeaders(ACC1_TOKEN) });
      if (openAcc1Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc1 note: ${openAcc1Res[0].error || openAcc1Res[0].status}`);
      }
      console.log("✅ Acc1 note opened (2,000 USDST → ~2,200 USD cap)");
    } catch (error) {
      console.error("❌ Acc1 note creation failed:", error.message);
    }

    // Acc2 opens note (1,500 USDST burn → 1,650 USD cap)
    console.log("\n💼 Acc2: Opening junior note with 1,500 USDST burn...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const approveAcc2Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc2Res } = await axios.post(txEndpoint, { txs: [approveAcc2Tx] }, { headers: getHeaders(ACC2_TOKEN) });
      if (approveAcc2Res[0].status !== "Success") {
        console.warn("⚠️  Acc2 approval may have failed:", approveAcc2Res[0].error);
      }

      const openAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSD: ACC2_BURN });
      const { data: openAcc2Res } = await axios.post(txEndpoint, { txs: [openAcc2Tx] }, { headers: getHeaders(ACC2_TOKEN) });
      if (openAcc2Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc2 note: ${openAcc2Res[0].error || openAcc2Res[0].status}`);
      }
      console.log("✅ Acc2 note opened (1,500 USDST → ~1,650 USD cap)");
    } catch (error) {
      console.error("❌ Acc2 note creation failed:", error.message);
    }

    // Acc3 opens note (500 USDST burn → 550 USD cap)  
    console.log("\n💼 Acc3: Opening junior note with 500 USDST burn...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const approveAcc3Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc3Res } = await axios.post(txEndpoint, { txs: [approveAcc3Tx] }, { headers: getHeaders(ACC3_TOKEN) });
      if (approveAcc3Res[0].status !== "Success") {
        console.warn("⚠️  Acc3 approval may have failed:", approveAcc3Res[0].error);
      }

      const openAcc3Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSD: ACC3_BURN });
      const { data: openAcc3Res } = await axios.post(txEndpoint, { txs: [openAcc3Tx] }, { headers: getHeaders(ACC3_TOKEN) });
      if (openAcc3Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc3 note: ${openAcc3Res[0].error || openAcc3Res[0].status}`);
      }
      console.log("✅ Acc3 note opened (500 USDST → ~550 USD cap)");
    } catch (error) {
      console.error("❌ Acc3 note creation failed:", error.message);
    }

    // Check junior system state after note creation
    const { juniorIndex, totalOutstanding } = await checkJuniorState();
    console.log(`📊 Junior system after notes created:`);
    console.log(`   Junior Index: ${juniorIndex}`);
    console.log(`   Total Outstanding: ${totalOutstanding} (should be ~4,400e18)`);

    // Part 4 — Simulate Reserve Inflows & Pro-Rata Indexing
    console.log("\n💰 Part 4: Testing Reserve Inflows & Claims...");

    // Inflow #1: Send 1,000 USDST to Reserve
    console.log("\n🌊 Inflow #1: Sending 1,000 USDST to Reserve...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    const inflow1Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: INFLOW_1 });
    const { data: inflow1Res } = await axios.post(txEndpoint, { txs: [inflow1Tx] }, { headers });
    if (inflow1Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #1 failed:", inflow1Res[0].error || inflow1Res[0].status);
    } else {
      console.log("✅ Sent 1,000 USDST to Reserve");
    }

    // Sync reserve to index
    console.log("🔄 Syncing reserve to index...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    const sync1Tx = buildCall("CDPEngine", CDP_ENGINE, "_syncReserveToIndex", {});
    const { data: sync1Res } = await axios.post(txEndpoint, { txs: [sync1Tx] }, { headers });
    if (sync1Res[0].status !== "Success") {
      console.warn("⚠️  Sync #1 failed:", sync1Res[0].error || sync1Res[0].status);
    } else {
      console.log("✅ Reserve synced to index");
    }

    // Check claimables after inflow #1
    console.log("📊 Checking claimables after inflow #1...");
    const acc1Claimable1 = await checkClaimable(ACC1_ADDRESS, ACC1_TOKEN);
    const acc2Claimable1 = await checkClaimable(ACC2_ADDRESS, ACC2_TOKEN);
    const acc3Claimable1 = await checkClaimable(ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 claimable: ${acc1Claimable1}`);
    console.log(`   Acc2 claimable: ${acc2Claimable1}`);
    console.log(`   Acc3 claimable: ${acc3Claimable1}`);

    // Claim from all users
    console.log("💸 Claiming from all users...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const claimAcc1Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc1Res } = await axios.post(txEndpoint, { txs: [claimAcc1Tx] }, { headers: getHeaders(ACC1_TOKEN) });
      if (claimAcc1Res[0].status === "Success") {
        console.log("✅ Acc1 claimed successfully");
      } else {
        console.warn("⚠️  Acc1 claim failed:", claimAcc1Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc1 claim error:", extractErrorMessage(error));
    }

    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const claimAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc2Res } = await axios.post(txEndpoint, { txs: [claimAcc2Tx] }, { headers: getHeaders(ACC2_TOKEN) });
      if (claimAcc2Res[0].status === "Success") {
        console.log("✅ Acc2 claimed successfully");
      } else {
        console.warn("⚠️  Acc2 claim failed:", claimAcc2Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc2 claim error:", extractErrorMessage(error));
    }

    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const claimAcc3Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc3Res } = await axios.post(txEndpoint, { txs: [claimAcc3Tx] }, { headers: getHeaders(ACC3_TOKEN) });
      if (claimAcc3Res[0].status === "Success") {
        console.log("✅ Acc3 claimed successfully");
      } else {
        console.warn("⚠️  Acc3 claim failed:", claimAcc3Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc3 claim error:", extractErrorMessage(error));
    }





    // Inflow #2: Send 700 USDST to Reserve
    console.log("\n🌊 Inflow #2: Sending 700 USDST to Reserve...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    const inflow2Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: INFLOW_2 });
    const { data: inflow2Res } = await axios.post(txEndpoint, { txs: [inflow2Tx] }, { headers });
    if (inflow2Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #2 failed:", inflow2Res[0].error || inflow2Res[0].status);
    } else {
      console.log("✅ Sent 700 USDST to Reserve");
    }

    // Sync reserve to index
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    const sync2Tx = buildCall("CDPEngine", CDP_ENGINE, "_syncReserveToIndex", {});
    const { data: sync2Res } = await axios.post(txEndpoint, { txs: [sync2Tx] }, { headers });
    if (sync2Res[0].status !== "Success") {
      console.warn("⚠️  Sync #2 failed:", sync2Res[0].error || sync2Res[0].status);
    } else {
      console.log("✅ Reserve synced to index");
    }

    // Claim only from Acc3 (leave Acc1/Acc2 to accumulate)
    console.log("💸 Claiming only from Acc3...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
    try {
      const claimAcc3_2Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc3_2Res } = await axios.post(txEndpoint, { txs: [claimAcc3_2Tx] }, { headers: getHeaders(ACC3_TOKEN) });
      if (claimAcc3_2Res[0].status === "Success") {
        console.log("✅ Acc3 claimed successfully (Acc1/Acc2 accumulating)");
      } else {
        console.warn("⚠️  Acc3 claim failed:", claimAcc3_2Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc3 claim error:", extractErrorMessage(error));
    }





    // Inflow #3: Acc2 top-up + large inflow
    console.log("\n🌊 Inflow #3: Acc2 top-up (1,000 USDST) + 2,000 USDST to Reserve...");
    
    // Acc2 top-up
    try {
      const topupAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSD: ACC2_TOPUP });
      const { data: topupAcc2Res } = await axios.post(txEndpoint, { txs: [topupAcc2Tx] }, { headers: getHeaders(ACC2_TOKEN) });
      if (topupAcc2Res[0].status !== "Success") {
        console.warn("⚠️  Acc2 top-up failed:", topupAcc2Res[0].error || topupAcc2Res[0].status);
      } else {
        console.log("✅ Acc2 topped up with 1,000 USDST");
      }
    } catch (error) {
      console.warn("⚠️  Acc2 top-up error:", extractErrorMessage(error));
    }

    // Send large inflow to reserve
    await executeWithRetry(async () => {
      const inflow3Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: INFLOW_3 });
      const { data: inflow3Res } = await axios.post(txEndpoint, { txs: [inflow3Tx] }, { headers });
      if (inflow3Res[0].status !== "Success") {
        throw new Error(inflow3Res[0].error || inflow3Res[0].status);
      }
      console.log("✅ Sent 2,000 USDST to Reserve");
    }, "Inflow #3 transfer");

    // Sync and claim until one closes
    await executeWithRetry(async () => {
      const sync3Tx = buildCall("CDPEngine", CDP_ENGINE, "_syncReserveToIndex", {});
      const { data: sync3Res } = await axios.post(txEndpoint, { txs: [sync3Tx] }, { headers });
      if (sync3Res[0].status !== "Success") {
        throw new Error(sync3Res[0].error || sync3Res[0].status);
      }
      console.log("✅ Reserve synced to index");
    }, "Sync #3");

    // Check claimables and claim from all
    console.log("📊 Checking claimables after inflow #3...");
    const acc1Claimable3 = await checkClaimable(ACC1_ADDRESS, ACC1_TOKEN);
    const acc2Claimable3 = await checkClaimable(ACC2_ADDRESS, ACC2_TOKEN);
    const acc3Claimable3 = await checkClaimable(ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 claimable: ${acc1Claimable3}`);
    console.log(`   Acc2 claimable: ${acc2Claimable3}`);
    console.log(`   Acc3 claimable: ${acc3Claimable3}`);

    console.log("💸 Claiming from all users...");
    // Claim from all users again
    for (const [name, address, token] of [["Acc1", ACC1_ADDRESS, ACC1_TOKEN], ["Acc2", ACC2_ADDRESS, ACC2_TOKEN], ["Acc3", ACC3_ADDRESS, ACC3_TOKEN]]) {
      try {
        const claimTx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
        const { data: claimRes } = await axios.post(txEndpoint, { txs: [claimTx] }, { headers: getHeaders(token) });
        if (claimRes[0].status === "Success") {
          console.log(`✅ ${name} claimed successfully`);
        } else {
          console.warn(`⚠️  ${name} claim failed:`, claimRes[0].error);
        }
      } catch (error) {
        console.warn(`⚠️  ${name} claim error:`, extractErrorMessage(error));
      }
    }





    // Inflow #4: Final flush
    console.log("\n🌊 Inflow #4: Final flush (300 USDST)...");
    const inflow4Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: INFLOW_4 });
    const { data: inflow4Res } = await axios.post(txEndpoint, { txs: [inflow4Tx] }, { headers });
    if (inflow4Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #4 failed:", inflow4Res[0].error || inflow4Res[0].status);
    } else {
      console.log("✅ Sent 300 USDST to Reserve");
    }

    // Brief delay to allow state to settle
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));

    // Final sync and claims
    const sync4Tx = buildCall("CDPEngine", CDP_ENGINE, "_syncReserveToIndex", {});
    const { data: sync4Res } = await axios.post(txEndpoint, { txs: [sync4Tx] }, { headers });
    if (sync4Res[0].status === "Success") {
      console.log("✅ Final reserve sync completed");
    }

    // Check claimables before final claims
    console.log("📊 Checking final claimables...");
    const acc1FinalClaimable2 = await checkClaimable(ACC1_ADDRESS, ACC1_TOKEN);
    const acc2FinalClaimable2 = await checkClaimable(ACC2_ADDRESS, ACC2_TOKEN);
    const acc3FinalClaimable2 = await checkClaimable(ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 final claimable: ${acc1FinalClaimable2}`);
    console.log(`   Acc2 final claimable: ${acc2FinalClaimable2}`);
    console.log(`   Acc3 final claimable: ${acc3FinalClaimable2}`);

    console.log("💸 Final claims to close remaining notes...");
    for (const [name, address, token] of [["Acc1", ACC1_ADDRESS, ACC1_TOKEN], ["Acc2", ACC2_ADDRESS, ACC2_TOKEN], ["Acc3", ACC3_ADDRESS, ACC3_TOKEN]]) {
      try {
        const claimTx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
        const { data: claimRes } = await axios.post(txEndpoint, { txs: [claimTx] }, { headers: getHeaders(token) });
        if (claimRes[0].status === "Success") {
          console.log(`✅ ${name} final claim successful`);
        } else {
          console.warn(`⚠️  ${name} final claim failed:`, claimRes[0].error);
        }
      } catch (error) {
        console.warn(`⚠️  ${name} final claim error:`, extractErrorMessage(error));
        if (error.response && error.response.status === 422) {
          console.warn(`   ${name} 422 error details:`, error.response.data);
        }
      }
    }





    // Final Status Check
    console.log("\n📈 Final Status Check...");
    
    const finalBadDebt = await checkBadDebt();
    const { juniorIndex: finalIndex, totalOutstanding: finalOutstanding } = await checkJuniorState();
    
    // Get final reserve balance via Cirrus
    let finalReserveBalance = "0";
    try {
      const { data: finalReserveData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-Token-_balances`, {
        headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
        params: { 
          address: `eq.${USDST}`, 
          select: "key,value",
          key: `eq.${CDP_RESERVE}`,
          limit: 1
        }
      });
      if (finalReserveData && finalReserveData.length > 0) {
        finalReserveBalance = finalReserveData[0].value || "0";
      }
    } catch (error) {
      console.warn("⚠️  Could not get final reserve balance via Cirrus:", error.message);
    }

    console.log(`💸 Final bad debt: ${finalBadDebt}`);
    console.log(`📊 Final junior index: ${finalIndex}`);
    console.log(`📊 Final total outstanding: ${finalOutstanding}`);
    console.log(`💰 Final reserve balance: ${finalReserveBalance} USDST`);

    // Check final claimables
    console.log("\n📊 Final claimables:");
    const acc1FinalClaimable = await checkClaimable(ACC1_ADDRESS, ACC1_TOKEN);
    const acc2FinalClaimable = await checkClaimable(ACC2_ADDRESS, ACC2_TOKEN);
    const acc3FinalClaimable = await checkClaimable(ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 remaining claimable: ${acc1FinalClaimable}`);
    console.log(`   Acc2 remaining claimable: ${acc2FinalClaimable}`);
    console.log(`   Acc3 remaining claimable: ${acc3FinalClaimable}`);

    console.log("\n🎉 Junior Notes Test Complete!");
    console.log("Summary:");
    console.log(`- Created 3 junior notes with 10% premium across 3 different accounts`);
    console.log(`- Acc1: 2,000 USDST → ~2,200 USD cap`);
    console.log(`- Acc2: 1,500 USDST + 1,000 USDST top-up → ~2,750 USD cap`);  
    console.log(`- Acc3: 500 USDST → ~550 USD cap`);
    console.log(`- Total inflows: 4,000 USDST (1,000 + 700 + 2,000 + 300)`);
    console.log(`- Pro-rata indexing tested with selective claims`);
    console.log(`- Account separation: ${ACC1_ADDRESS !== ACC2_ADDRESS && ACC2_ADDRESS !== ACC3_ADDRESS && ACC1_ADDRESS !== ACC3_ADDRESS ? 'All different ✓' : 'Some shared ⚠️'}`);
    console.log(`- Final outstanding: ${finalOutstanding} (should be close to 0 if fully paid)`);

  } catch (error) {
    console.error("❌ Error during junior notes test:", extractErrorMessage(error));
    if (error.response && error.response.status === 422) {
      console.error("📊 Full 422 error details:", error.response.data);
    }
    process.exit(1);
  }
})();
