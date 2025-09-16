require('dotenv').config();
const axios = require('axios');

// Environment variables
const ACC1_TOKEN = process.env.ACC1_TOKEN;
const ACC2_TOKEN = process.env.ACC2_TOKEN;
const ACC3_TOKEN = process.env.ACC3_TOKEN;
const CDP_ENGINE = process.env.CDP_ENGINE;
const CDP_RESERVE = process.env.CDP_RESERVE;
const USDST = process.env.USDST || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const ROOT = process.env.ROOT || "https://buildtest.mercata-testnet.blockapps.net";

// Validation
if (!ACC1_TOKEN) throw new Error("ACC1_TOKEN JWT required");
if (!ACC2_TOKEN) throw new Error("ACC2_TOKEN JWT required");
if (!ACC3_TOKEN) throw new Error("ACC3_TOKEN JWT required");
if (!CDP_ENGINE) throw new Error("CDP_ENGINE address required");
if (!CDP_RESERVE) throw new Error("CDP_RESERVE address required");
if (!USDST) throw new Error("USDST address required");

const main = async () => {
  // ═══════════════ CONFIGURATION ═══════════════
  // Adjust TRANSACTION_DELAY based on network conditions:
  // - Fast networks: 500-1000ms
  // - Slow/congested networks: 2000-5000ms
  const TRANSACTION_DELAY = 1000; // milliseconds between transactions

  console.log(`🔄 Junior Notes Reset Script Starting...`);
  console.log(`🏭 CDP Engine: ${CDP_ENGINE}`);
  console.log(`🌐 Node: ${ROOT}\n`);

  const txEndpoint = `${ROOT}/strato/v2.3/transaction/parallel?resolve=true`;
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });
  const getHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  
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

  try {



    // Step 1: Check existing junior notes
    console.log("📝 Step 1: Checking existing junior notes...");
    const { data: notesData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-CDPEngine-juniorNotes`, {
      headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
      params: { 
        address: `eq.${CDP_ENGINE}`, 
        select: "key,value"
      }
    });
    
    if (!notesData || notesData.length === 0) {
      console.log("✅ No existing junior notes found - already clean");
      return;
    }
    
    console.log(`📊 Found ${notesData.length} existing junior notes to clean up:`);
    const accountTokenMap = {
      [process.env.ACC1_ADDRESS || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce"]: ACC1_TOKEN,
      [process.env.ACC2_ADDRESS || "c714b751376045eb67d19ad7329dc0003adfd253"]: ACC2_TOKEN,
      [process.env.ACC3_ADDRESS || "3287f1ad89b0ac875b58a65ceaf40bc7a6cc8041"]: ACC3_TOKEN
    };
    
    // Calculate total cap needed
    let totalCapNeeded = BigInt(0);
    for (const note of notesData) {
      const owner = note.key;
      const noteData = note.value;
      const capUSD = BigInt(noteData.capUSD || 0);
      totalCapNeeded += capUSD;
      console.log(`   Owner: ${owner}, Cap: ${Number(capUSD) / 1e18} USDST`);
    }
    
    console.log(`💰 Total cap to close all notes: ${Number(totalCapNeeded) / 1e18} USDST`);
    
    // Add 50% buffer to ensure we can close everything
    const fundingAmount = (totalCapNeeded * BigInt(150)) / BigInt(100); // 1.5x buffer
    console.log(`💸 Funding reserve with: ${Number(fundingAmount) / 1e18} USDST (with 50% buffer)`);
    
    // Step 1.5: Fund the reserve with more than enough USDST
    console.log("\n💰 Step 1.5: Funding reserve to ensure all notes can be claimed...");
    const headers = getHeaders(ACC1_TOKEN);
    
    try {
      await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
      const fundTx = buildCall("Token", USDST, "transfer", { 
        to: CDP_RESERVE, 
        value: fundingAmount.toString() 
      });
      const { data: fundRes } = await axios.post(txEndpoint, { txs: [fundTx] }, { headers });
      
      if (fundRes[0].status !== "Success") {
        console.warn("⚠️  Reserve funding failed:", fundRes[0].error || fundRes[0].status);
        console.warn("Continuing anyway - existing reserve balance may be sufficient");
      } else {
        console.log("✅ Reserve funded successfully");
      }
    } catch (error) {
      console.warn("⚠️  Reserve funding error:", error.message);
      console.warn("Continuing anyway - existing reserve balance may be sufficient");
    }
    
    // Sync reserve to index
    console.log("🔄 Syncing reserve to index...");
    try {
      await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
      const syncTx = buildCall("CDPEngine", CDP_ENGINE, "_syncReserveToIndex", {});
      const { data: syncRes } = await axios.post(txEndpoint, { txs: [syncTx] }, { headers });
      
      if (syncRes[0].status !== "Success") {
        console.warn("⚠️  Reserve sync failed:", syncRes[0].error || syncRes[0].status);
      } else {
        console.log("✅ Reserve synced to index");
      }
    } catch (error) {
      console.warn("⚠️  Reserve sync error:", error.message);
    }





    // Step 2: Claim all existing junior notes
    console.log("\n💸 Step 2: Claiming all existing junior notes...");
    let claimedCount = 0;
    let errorCount = 0;
    
    for (const note of notesData) {
      const owner = note.key.toLowerCase();
      const token = accountTokenMap[owner];
      
      if (!token) {
        console.warn(`⚠️  No token found for owner ${owner} - skipping`);
        continue;
      }
      
      try {
        console.log(`   Claiming note for ${owner}...`);
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY));
        
        await executeWithRetry(async () => {
          const claimTx = buildCall("CDPEngine", CDP_ENGINE, "claimJunior", {});
          const { data: claimRes } = await axios.post(txEndpoint, { txs: [claimTx] }, { headers: getHeaders(token) });
          
          if (claimRes[0].status !== "Success") {
            throw new Error(claimRes[0].error || claimRes[0].status);
          }
          console.log(`   ✅ Successfully claimed note for ${owner}`);
        }, `Claim for ${owner}`);
        
        claimedCount++;
      } catch (error) {
        console.warn(`   ❌ Error claiming note for ${owner}:`, extractErrorMessage(error));
        if (error.response && error.response.status === 422) {
          console.warn(`      Full 422 details:`, error.response.data);
        }
        errorCount++;
      }
    }




    
    // Step 3: Verify cleanup
    console.log("\n🔍 Step 3: Verifying cleanup...");
    await new Promise(resolve => setTimeout(resolve, TRANSACTION_DELAY * 2)); // Wait for state to update
    
    const { data: finalNotesData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-CDPEngine-juniorNotes`, {
      headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
      params: { 
        address: `eq.${CDP_ENGINE}`, 
        select: "key,value"
      }
    });
    
    const remainingNotes = finalNotesData ? finalNotesData.length : 0;
    
    console.log(`📊 Cleanup Results:`);
    console.log(`   Successfully claimed: ${claimedCount} notes`);
    console.log(`   Errors: ${errorCount} notes`);
    console.log(`   Remaining notes: ${remainingNotes} notes`);
    
    if (remainingNotes === 0) {
      console.log("🎉 Junior notes reset complete! Ready for testing.");
    } else {
      console.log("⚠️  Some notes may still exist - check manually if needed.");
      if (finalNotesData) {
        for (const note of finalNotesData) {
          const capUSD = Number(note.value.capUSD || 0) / 1e18;
          console.log(`   Remaining: ${note.key} with ${capUSD} USDST cap`);
        }
      }
    }

  } catch (error) {
    console.error("❌ Reset failed:", extractErrorMessage(error));
    if (error.response && error.response.status === 422) {
      console.error("📊 Full 422 error details:", error.response.data);
    }
    process.exit(1);
  }
};

main().catch(error => {
  console.error("❌ Unexpected error:", error.message);
  process.exit(1);
});
