// Junior Notes Test: Test the junior note system with bad debt recovery
// Required: ADMIN_TOKEN (JWT for setJuniorPremium), ACC1_TOKEN, ACC2_TOKEN, ACC3_TOKEN (JWTs for users), CDP contract addresses in .env
// Role separation: ADMIN sets premium, ACC1/ACC2/ACC3 open notes and claim
// Prerequisite: Run setupCDPTest.js first to create bad debt

const axios = require("axios");
require("dotenv").config();

// Import utility functions
const { checkBadDebt, checkJuniorState, checkClaimable, getTokenBalance } = require("./util/cirrusHelpers");
const { buildCall, createHeaders, extractErrorMessage, executeWithRetry, sleep, validateEnvironment, setupApiConfig } = require("./util/transactionHelpers");
const { getEnvironmentConfig, getRequiredEnvironment, JUNIOR_TEST_AMOUNTS, TIMING } = require("./util/constants");

(async () => {
  // Get environment configuration
  const config = getEnvironmentConfig();
  const requiredEnv = getRequiredEnvironment('junior');
  
  // Validate required environment variables
  validateEnvironment(requiredEnv);
  
  // Destructure configuration
  const {
    ADMIN_TOKEN, ACC1_TOKEN, ACC2_TOKEN, ACC3_TOKEN,
    ADMIN_ADDRESS, ACC1_ADDRESS, ACC2_ADDRESS, ACC3_ADDRESS,
    USDST, ETHST, CDP_ENGINE, CDP_RESERVE
  } = config;
  
  // Setup API configuration
  const { ROOT, txEndpoint } = setupApiConfig();
  
  // Create headers for different accounts
  const headers = createHeaders({ ADMIN_TOKEN, ACC1_TOKEN, ACC2_TOKEN, ACC3_TOKEN });
  
  // Use constants for test amounts and timing
  const TRANSACTION_DELAY = TIMING.TRANSACTION_DELAY;

  // Helper functions - now imported from utilities

  console.log(`🚀 Junior Notes Test Starting...`);
  console.log(`👤 Account Mapping:`);
  console.log(`   Admin: ${ADMIN_ADDRESS} (premium setting only)`);
  console.log(`   Acc1: ${ACC1_ADDRESS} (user operations)`);
  console.log(`   Acc2: ${ACC2_ADDRESS} (user operations)`);
  console.log(`   Acc3: ${ACC3_ADDRESS} (user operations)`);
  console.log(`🏭 CDP Engine: ${CDP_ENGINE}`);

  try {



    // Part 2 — Verify Bad Debt & Configure Juniors
    console.log("\n📊 Part 2: Verifying Bad Debt & Configuring Junior System...");
    
    // Check initial bad debt - must have enough for the test (≥ 4,400 USDST)
    const badDebtResult = await checkBadDebt(ROOT, CDP_ENGINE, ACC1_TOKEN);
    const initialBadDebtNum = Number(badDebtResult.totalBadDebt);
    const requiredBadDebt = Number(JUNIOR_TEST_AMOUNTS.REQUIRED_BAD_DEBT);
    
    console.log(`💸 Initial bad debt: ${initialBadDebtNum / 1e18} USDST`);
    console.log(`💸 Required bad debt: ${requiredBadDebt / 1e18} USDST`);
    
    if (badDebtResult.entries.length > 0) {
      console.log(`📊 Bad debt breakdown:`);
      badDebtResult.entries.forEach((entry, i) => {
        console.log(`   Asset ${i + 1}: ${entry.asset} = ${Number(entry.badDebt) / 1e18} USDST`);
      });
    }
    
    if (initialBadDebtNum === 0) {
      throw new Error("No bad debt found! Run setupCDPTest.js first to create bad debt.");
    }
    
    if (initialBadDebtNum < requiredBadDebt) {
      throw new Error(`Insufficient bad debt! Found ${initialBadDebtNum / 1e18} USDST, need at least ${requiredBadDebt / 1e18} USDST. Run setupCDPTest.js first.`);
    }
    
    console.log("✅ Sufficient bad debt available for testing");

    // Set junior premium to 10%
    console.log("\n🔧 Setting junior premium to 10%... (ADMIN ONLY)");
    await sleep(TRANSACTION_DELAY);
    try {
      const setPremiumTx = buildCall("CDPEngine", CDP_ENGINE, "setJuniorPremium", {
        newPremiumBps: JUNIOR_TEST_AMOUNTS.JUNIOR_PREMIUM
      });
      const { data: setPremiumRes } = await axios.post(txEndpoint, { txs: [setPremiumTx] }, { headers: headers.admin });
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
    const initialReserveBalance = await getTokenBalance(ROOT, USDST, CDP_RESERVE, ACC1_TOKEN);
    console.log(`💰 Initial CDP Reserve balance: ${Number(initialReserveBalance) / 1e18} USDST`);





    // Part 3 — Open 3 Junior Notes
    console.log("\n📝 Part 3: Opening Junior Notes...");

    // Ensure users have USDST - transfer from acc1 to acc2 and acc3
    console.log("💸 Transferring USDST to users for junior notes...");
    try {
      // Transfer to acc2
      await sleep(TRANSACTION_DELAY);
      const transferToAcc2Tx = buildCall("Token", USDST, "transfer", { 
        to: ACC2_ADDRESS, 
        value: JUNIOR_TEST_AMOUNTS.TRANSFER_TO_ACC2
      });
      const { data: transferAcc2Res } = await axios.post(txEndpoint, { txs: [transferToAcc2Tx] }, { headers: headers.acc1 });
      if (transferAcc2Res[0].status === "Success") {
        console.log("✅ Transferred USDST to Acc2");
      }

      // Transfer to acc3
      if (ACC3_ADDRESS !== ACC1_ADDRESS) {
        await sleep(TRANSACTION_DELAY);
        const transferToAcc3Tx = buildCall("Token", USDST, "transfer", { 
          to: ACC3_ADDRESS, 
          value: JUNIOR_TEST_AMOUNTS.TRANSFER_TO_ACC3
        });
        const { data: transferAcc3Res } = await axios.post(txEndpoint, { txs: [transferToAcc3Tx] }, { headers: headers.acc1 });
        if (transferAcc3Res[0].status === "Success") {
          console.log("✅ Transferred USDST to Acc3");
        }
      }
    } catch (error) {
      console.warn("⚠️  USDST transfers may have failed:", error.message);
    }

    // Ensure users approve CDPEngine for burns
    const approveAmount = JUNIOR_TEST_AMOUNTS.APPROVAL_AMOUNT;
    
    // Acc1 opens note (2,000 USDST burn → 2,200 USDST cap)
    console.log("\n💼 Acc1: Opening junior note with 2,000 USDST burn...");
    await sleep(TRANSACTION_DELAY);
    try {
      // Approve if needed
      const approveAcc1Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc1Res } = await axios.post(txEndpoint, { txs: [approveAcc1Tx] }, { headers: headers.acc1 });
      if (approveAcc1Res[0].status !== "Success") {
        console.warn("⚠️  Acc1 approval may have failed:", approveAcc1Res[0].error);
      }

      const openAcc1Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSDST: JUNIOR_TEST_AMOUNTS.ACC1_BURN });
      const { data: openAcc1Res } = await axios.post(txEndpoint, { txs: [openAcc1Tx] }, { headers: headers.acc1 });
      if (openAcc1Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc1 note: ${openAcc1Res[0].error || openAcc1Res[0].status}`);
      }
      console.log("✅ Acc1 note opened (2,000 USDST → ~2,200 USDST cap)");
    } catch (error) {
      console.error("❌ Acc1 note creation failed:", error.message);
    }

    // Acc2 opens note (1,500 USDST burn → 1,650 USDST cap)
    console.log("\n💼 Acc2: Opening junior note with 1,500 USDST burn...");
    await sleep(TRANSACTION_DELAY);
    try {
      const approveAcc2Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc2Res } = await axios.post(txEndpoint, { txs: [approveAcc2Tx] }, { headers: headers.acc2 });
      if (approveAcc2Res[0].status !== "Success") {
        console.warn("⚠️  Acc2 approval may have failed:", approveAcc2Res[0].error);
      }

      const openAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSDST: JUNIOR_TEST_AMOUNTS.ACC2_BURN });
      const { data: openAcc2Res } = await axios.post(txEndpoint, { txs: [openAcc2Tx] }, { headers: headers.acc2 });
      if (openAcc2Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc2 note: ${openAcc2Res[0].error || openAcc2Res[0].status}`);
      }
      console.log("✅ Acc2 note opened (1,500 USDST → ~1,650 USDST cap)");
    } catch (error) {
      console.error("❌ Acc2 note creation failed:", error.message);
    }

    // Acc3 opens note (500 USDST burn → 550 USDST cap)  
    console.log("\n💼 Acc3: Opening junior note with 500 USDST burn...");
    await sleep(TRANSACTION_DELAY);
    try {
      const approveAcc3Tx = buildCall("Token", USDST, "approve", { spender: CDP_ENGINE, value: approveAmount });
      const { data: approveAcc3Res } = await axios.post(txEndpoint, { txs: [approveAcc3Tx] }, { headers: headers.acc3 });
      if (approveAcc3Res[0].status !== "Success") {
        console.warn("⚠️  Acc3 approval may have failed:", approveAcc3Res[0].error);
      }

      const openAcc3Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSDST: JUNIOR_TEST_AMOUNTS.ACC3_BURN });
      const { data: openAcc3Res } = await axios.post(txEndpoint, { txs: [openAcc3Tx] }, { headers: headers.acc3 });
      if (openAcc3Res[0].status !== "Success") {
        throw new Error(`Failed to open Acc3 note: ${openAcc3Res[0].error || openAcc3Res[0].status}`);
      }
      console.log("✅ Acc3 note opened (500 USDST → ~550 USDST cap)");
    } catch (error) {
      console.error("❌ Acc3 note creation failed:", error.message);
    }

    // Check junior system state after note creation
    const { juniorIndex, totalOutstanding } = await checkJuniorState(ROOT, CDP_ENGINE, ACC1_TOKEN);
    console.log(`📊 Junior system after notes created:`);
    console.log(`   Junior Index: ${juniorIndex}`);
    console.log(`   Total Outstanding: ${totalOutstanding} (should be ~4,400e18)`);

    // Part 4 — Simulate Reserve Inflows & Pro-Rata Indexing
    console.log("\n💰 Part 4: Testing Reserve Inflows & Claims...");

    // Inflow #1: Send 1,000 USDST to Reserve
    console.log("\n🌊 Inflow #1: Sending 1,000 USDST to Reserve...");
    await sleep(TRANSACTION_DELAY);
    const inflow1Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: JUNIOR_TEST_AMOUNTS.INFLOW_1 });
    const { data: inflow1Res } = await axios.post(txEndpoint, { txs: [inflow1Tx] }, { headers: headers.acc1 });
    if (inflow1Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #1 failed:", inflow1Res[0].error || inflow1Res[0].status);
    } else {
      console.log("✅ Sent 1,000 USDST to Reserve");
    }

    // Note: _syncReserveToIndex is now internal and handled automatically by junior note operations

    // Check claimables after inflow #1
    console.log("📊 Checking claimables after inflow #1...");
    const acc1Claimable1 = await checkClaimable(ROOT, CDP_ENGINE, ACC1_ADDRESS, ACC1_TOKEN);
    const acc2Claimable1 = await checkClaimable(ROOT, CDP_ENGINE, ACC2_ADDRESS, ACC2_TOKEN);
    const acc3Claimable1 = await checkClaimable(ROOT, CDP_ENGINE, ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 claimable: ${acc1Claimable1}`);
    console.log(`   Acc2 claimable: ${acc2Claimable1}`);
    console.log(`   Acc3 claimable: ${acc3Claimable1}`);

    // Claim from all users
    console.log("💸 Claiming from all users...");
    await sleep(TRANSACTION_DELAY);
    try {
      const claimAcc1Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc1Res } = await axios.post(txEndpoint, { txs: [claimAcc1Tx] }, { headers: headers.acc1 });
      if (claimAcc1Res[0].status === "Success") {
        console.log("✅ Acc1 claimed successfully");
      } else {
        console.warn("⚠️  Acc1 claim failed:", claimAcc1Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc1 claim error:", extractErrorMessage(error));
    }

    await sleep(TRANSACTION_DELAY);
    try {
      const claimAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc2Res } = await axios.post(txEndpoint, { txs: [claimAcc2Tx] }, { headers: headers.acc2 });
      if (claimAcc2Res[0].status === "Success") {
        console.log("✅ Acc2 claimed successfully");
      } else {
        console.warn("⚠️  Acc2 claim failed:", claimAcc2Res[0].error);
      }
    } catch (error) {
      console.warn("⚠️  Acc2 claim error:", extractErrorMessage(error));
    }

    await sleep(TRANSACTION_DELAY);
    try {
      const claimAcc3Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc3Res } = await axios.post(txEndpoint, { txs: [claimAcc3Tx] }, { headers: headers.acc3 });
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
    await sleep(TRANSACTION_DELAY);
    const inflow2Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: JUNIOR_TEST_AMOUNTS.INFLOW_2 });
    const { data: inflow2Res } = await axios.post(txEndpoint, { txs: [inflow2Tx] }, { headers: headers.acc1 });
    if (inflow2Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #2 failed:", inflow2Res[0].error || inflow2Res[0].status);
    } else {
      console.log("✅ Sent 700 USDST to Reserve");
    }

    // Note: _syncReserveToIndex is now internal and handled automatically

    // Claim only from Acc3 (leave Acc1/Acc2 to accumulate)
    console.log("💸 Claiming only from Acc3...");
    await sleep(TRANSACTION_DELAY);
    try {
      const claimAcc3_2Tx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
      const { data: claimAcc3_2Res } = await axios.post(txEndpoint, { txs: [claimAcc3_2Tx] }, { headers: headers.acc3 });
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
      const topupAcc2Tx = buildCall("CDPEngine", CDP_ENGINE, "openJuniorNote", { asset: ETHST, amountUSDST: JUNIOR_TEST_AMOUNTS.ACC2_TOPUP });
      const { data: topupAcc2Res } = await axios.post(txEndpoint, { txs: [topupAcc2Tx] }, { headers: headers.acc2 });
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
      const inflow3Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: JUNIOR_TEST_AMOUNTS.INFLOW_3 });
      const { data: inflow3Res } = await axios.post(txEndpoint, { txs: [inflow3Tx] }, { headers: headers.acc1 });
      if (inflow3Res[0].status !== "Success") {
        throw new Error(inflow3Res[0].error || inflow3Res[0].status);
      }
      console.log("✅ Sent 2,000 USDST to Reserve");
    }, "Inflow #3 transfer");

    // Note: _syncReserveToIndex is now internal and handled automatically by claims

    // Check claimables and claim from all
    console.log("📊 Checking claimables after inflow #3...");
    const acc1Claimable3 = await checkClaimable(ROOT, CDP_ENGINE, ACC1_ADDRESS, ACC1_TOKEN);
    const acc2Claimable3 = await checkClaimable(ROOT, CDP_ENGINE, ACC2_ADDRESS, ACC2_TOKEN);
    const acc3Claimable3 = await checkClaimable(ROOT, CDP_ENGINE, ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 claimable: ${acc1Claimable3}`);
    console.log(`   Acc2 claimable: ${acc2Claimable3}`);
    console.log(`   Acc3 claimable: ${acc3Claimable3}`);

    console.log("💸 Claiming from all users...");
    // Claim from all users again
    for (const [name, address, token] of [["Acc1", ACC1_ADDRESS, ACC1_TOKEN], ["Acc2", ACC2_ADDRESS, ACC2_TOKEN], ["Acc3", ACC3_ADDRESS, ACC3_TOKEN]]) {
      try {
        const claimTx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
        const { data: claimRes } = await axios.post(txEndpoint, { txs: [claimTx] }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
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
    const inflow4Tx = buildCall("Token", USDST, "transfer", { to: CDP_RESERVE, value: JUNIOR_TEST_AMOUNTS.INFLOW_4 });
    const { data: inflow4Res } = await axios.post(txEndpoint, { txs: [inflow4Tx] }, { headers: headers.acc1 });
    if (inflow4Res[0].status !== "Success") {
      console.warn("⚠️  Inflow #4 failed:", inflow4Res[0].error || inflow4Res[0].status);
    } else {
      console.log("✅ Sent 300 USDST to Reserve");
    }

    // Brief delay to allow state to settle
    await sleep(TRANSACTION_DELAY);

    // Note: _syncReserveToIndex is now internal and handled automatically by claims

    // Check claimables before final claims
    console.log("📊 Checking final claimables...");
    const acc1FinalClaimable2 = await checkClaimable(ROOT, CDP_ENGINE, ACC1_ADDRESS, ACC1_TOKEN);
    const acc2FinalClaimable2 = await checkClaimable(ROOT, CDP_ENGINE, ACC2_ADDRESS, ACC2_TOKEN);
    const acc3FinalClaimable2 = await checkClaimable(ROOT, CDP_ENGINE, ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 final claimable: ${acc1FinalClaimable2}`);
    console.log(`   Acc2 final claimable: ${acc2FinalClaimable2}`);
    console.log(`   Acc3 final claimable: ${acc3FinalClaimable2}`);

    console.log("💸 Final claims to close remaining notes...");
    for (const [name, address, token] of [["Acc1", ACC1_ADDRESS, ACC1_TOKEN], ["Acc2", ACC2_ADDRESS, ACC2_TOKEN], ["Acc3", ACC3_ADDRESS, ACC3_TOKEN]]) {
      try {
        const claimTx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
        const { data: claimRes } = await axios.post(txEndpoint, { txs: [claimTx] }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
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
    
    const finalBadDebtResult = await checkBadDebt(ROOT, CDP_ENGINE, ACC1_TOKEN);
    const { juniorIndex: finalIndex, totalOutstanding: finalOutstanding } = await checkJuniorState(ROOT, CDP_ENGINE, ACC1_TOKEN);
    
    // Get final reserve balance via Cirrus
    const finalReserveBalance = await getTokenBalance(ROOT, USDST, CDP_RESERVE, ACC1_TOKEN);

    console.log(`💸 Final bad debt: ${Number(finalBadDebtResult.totalBadDebt) / 1e18} USDST`);
    console.log(`📊 Final junior index: ${finalIndex}`);
    console.log(`📊 Final total outstanding: ${finalOutstanding}`);
    console.log(`💰 Final reserve balance: ${Number(finalReserveBalance) / 1e18} USDST`);

    // Check final claimables
    console.log("\n📊 Final claimables:");
    const acc1FinalClaimable = await checkClaimable(ROOT, CDP_ENGINE, ACC1_ADDRESS, ACC1_TOKEN);
    const acc2FinalClaimable = await checkClaimable(ROOT, CDP_ENGINE, ACC2_ADDRESS, ACC2_TOKEN);
    const acc3FinalClaimable = await checkClaimable(ROOT, CDP_ENGINE, ACC3_ADDRESS, ACC3_TOKEN);
    console.log(`   Acc1 remaining claimable: ${acc1FinalClaimable}`);
    console.log(`   Acc2 remaining claimable: ${acc2FinalClaimable}`);
    console.log(`   Acc3 remaining claimable: ${acc3FinalClaimable}`);

    console.log("\n🎉 Junior Notes Test Complete!");
    console.log("Summary:");
    console.log(`- Created 3 junior notes with 10% premium across 3 different accounts`);
    console.log(`- Acc1: 2,000 USDST → ~2,200 USDST cap`);
    console.log(`- Acc2: 1,500 USDST + 1,000 USDST top-up → ~2,750 USDST cap`);  
    console.log(`- Acc3: 500 USDST → ~550 USDST cap`);
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
