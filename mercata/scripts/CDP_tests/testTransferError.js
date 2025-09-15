// Test script to verify Solidity error extraction from 422 responses
// Deliberately calls setRegistry from non-owner to trigger authorization error
// Required: ACC1_TOKEN, ACC2_TOKEN, CDP_ENGINE, CDP_REGISTRY in .env

const axios = require("axios");
require("dotenv").config();

(async () => {
  // ═══════════════ CONFIGURATION ═══════════════
  // Adjust TRANSACTION_DELAY based on network conditions:
  // - Fast networks: 500-1000ms
  // - Slow/congested networks: 2000-5000ms
  const TRANSACTION_DELAY = 1000; // milliseconds between transactions

  // Config
  const ACC1_TOKEN = process.env.ACC1_TOKEN;
  const ACC2_TOKEN = process.env.ACC2_TOKEN;
  const ACC1_ADDRESS = process.env.ACC1_ADDRESS || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
  const ACC2_ADDRESS = process.env.ACC2_ADDRESS || "c714b751376045eb67d19ad7329dc0003adfd253";
  const CDP_ENGINE = process.env.CDP_ENGINE;
  const CDP_REGISTRY = process.env.CDP_REGISTRY;

  if (!ACC1_TOKEN || !ACC2_TOKEN) throw new Error("ACC1_TOKEN and ACC2_TOKEN JWTs required");
  if (!CDP_ENGINE || !CDP_REGISTRY) throw new Error("CDP_ENGINE and CDP_REGISTRY addresses required");

  // API setup - Same as other scripts
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
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

  console.log(`🔍 Testing error handling with unauthorized setRegistry call...`);
  console.log(`CDP_ENGINE: ${CDP_ENGINE}`);
  console.log(`CDP_REGISTRY: ${CDP_REGISTRY}`);
  console.log(`ACC1_ADDRESS: ${ACC1_ADDRESS} (owner)`);
  console.log(`ACC2_ADDRESS: ${ACC2_ADDRESS} (non-owner)`);
  console.log(`Endpoint: ${txEndpoint}`);

  try {
    // First, let's try from the owner (should succeed)
    console.log(`\n📋 Step 1: Calling setRegistry from owner (should succeed)...`);
    const ownerHeaders = { Authorization: `Bearer ${ACC1_TOKEN}`, "Content-Type": "application/json" };
    
    const ownerSetRegistryTx = buildCall("CDPEngine", CDP_ENGINE, "setRegistry", { 
      _registry: CDP_REGISTRY 
    });
    
    console.log(`📋 Owner setRegistry payload:`, JSON.stringify(ownerSetRegistryTx, null, 2));
    
    const { data: ownerRes } = await axios.post(txEndpoint, { txs: [ownerSetRegistryTx] }, { headers: ownerHeaders });
    console.log(`📊 Owner call result:`, JSON.stringify(ownerRes, null, 2));
    
    // Now try from non-owner (should fail)
    console.log(`\n🚫 Step 2: Attempting unauthorized setRegistry call...`);
    console.log(`Trying to call setRegistry from ACC2 (non-owner)...`);
    
    const nonOwnerHeaders = { Authorization: `Bearer ${ACC2_TOKEN}`, "Content-Type": "application/json" };
    
    const nonOwnerSetRegistryTx = buildCall("CDPEngine", CDP_ENGINE, "setRegistry", { 
      _registry: CDP_REGISTRY 
    });
    
    console.log(`📋 Non-owner setRegistry payload:`, JSON.stringify(nonOwnerSetRegistryTx, null, 2));
    
    const { data: nonOwnerRes } = await axios.post(txEndpoint, { txs: [nonOwnerSetRegistryTx] }, { headers: nonOwnerHeaders });
    
    console.log(`📊 Non-owner call response:`, JSON.stringify(nonOwnerRes, null, 2));
    
    if (nonOwnerRes[0].status !== "Success") {
      console.log(`\n❌ Expected failure occurred!`);
      console.log(`Status: ${nonOwnerRes[0].status}`);
      console.log(`Error: ${nonOwnerRes[0].error}`);
    } else {
      console.log(`⚠️  Unexpected success - call should have failed!`);
    }

  } catch (error) {
    console.log(`\n🔍 Caught 422 error as expected:`);
    console.log(`✅ Clean error: ${extractErrorMessage(error)}`);
    
    if (error.response && error.response.status === 422) {
      console.log(`📊 Raw error data: ${error.response.data}`);
    }
    
    console.log(`\n✅ Error extraction working correctly!`);
  }
})();
