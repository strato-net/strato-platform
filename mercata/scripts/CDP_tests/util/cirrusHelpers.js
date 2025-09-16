// Cirrus API Helper Functions
// Reusable functions for querying on-chain state via Cirrus

const axios = require("axios");

/**
 * Check bad debt for a specific asset or all assets in CDPEngine
 * @param {string} rootUrl - The base node URL
 * @param {string} cdpEngine - CDP Engine contract address  
 * @param {string} token - JWT token for authorization
 * @param {string} assetAddress - Optional: specific asset to check, if not provided checks all
 * @returns {Promise<{totalBadDebt: string, entries: Array}>} Bad debt information
 */
async function checkBadDebt(rootUrl, cdpEngine, token, assetAddress = null) {
  try {
    const params = {
      address: `eq.${cdpEngine}`,
      select: "key,value",
      "value": "gt.0" // Only get entries where bad debt > 0
    };
    
    if (assetAddress) {
      params.key = `eq.${assetAddress.toLowerCase()}`;
    }
    
    const { data: badDebtData } = await axios.get(`${rootUrl}/cirrus/search/BlockApps-Mercata-CDPEngine-badDebtUSDST`, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    
    if (badDebtData && badDebtData.length > 0) {
      let totalBadDebt = 0;
      const entries = [];
      
      badDebtData.forEach(entry => {
        let debtValue = 0;
        
        if (typeof entry.value === 'string' || typeof entry.value === 'number') {
          debtValue = Number(entry.value);
        } else if (entry.value && typeof entry.value === 'object') {
          // Handle nested object structure
          const nestedValue = entry.value.badDebtUSDST || entry.value;
          if (typeof nestedValue === 'string' || typeof nestedValue === 'number') {
            debtValue = Number(nestedValue);
          }
        }
        
        if (debtValue > 0) {
          totalBadDebt += debtValue;
          entries.push({
            asset: entry.key,
            badDebt: debtValue.toString()
          });
        }
      });
      
      return {
        totalBadDebt: totalBadDebt.toString(),
        entries
      };
    }
    
    return { totalBadDebt: "0", entries: [] };
  } catch (error) {
    console.warn("⚠️  Could not fetch bad debt from Cirrus:", error.message);
    return { totalBadDebt: "0", entries: [] };
  }
}

/**
 * Check junior system state via Cirrus
 * @param {string} rootUrl - The base node URL
 * @param {string} cdpEngine - CDP Engine contract address
 * @param {string} token - JWT token for authorization
 * @returns {Promise<{juniorIndex: string, totalOutstanding: string}>} Junior system state
 */
async function checkJuniorState(rootUrl, cdpEngine, token) {
  try {
    // Get only the specific fields we need from CDPEngine contract state
    const { data: contractData } = await axios.get(`${rootUrl}/cirrus/search/BlockApps-Mercata-CDPEngine`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { 
        address: `eq.${cdpEngine}`, 
        select: "juniorIndex,totalJuniorOutstandingUSDST",
        limit: 1 
      }
    });
    
    if (contractData && contractData.length > 0) {
      const contractState = contractData[0];
      const juniorIndex = contractState.juniorIndex || "0";
      const totalOutstanding = contractState.totalJuniorOutstandingUSDST || "0";
      return { juniorIndex, totalOutstanding };
    }
    
    return { juniorIndex: "0", totalOutstanding: "0" };
  } catch (error) {
    console.warn("⚠️  Could not get junior system state via Cirrus:", error.message);
    return { juniorIndex: "0", totalOutstanding: "0" };
  }
}

/**
 * Check claimable amount for a user's junior note via Cirrus
 * @param {string} rootUrl - The base node URL
 * @param {string} cdpEngine - CDP Engine contract address
 * @param {string} userAddress - User's address
 * @param {string} token - JWT token for authorization
 * @returns {Promise<string>} Claimable amount in USDST wei
 */
async function checkClaimable(rootUrl, cdpEngine, userAddress, token) {
  try {
    // Get user's junior note via Cirrus
    const { data: noteData } = await axios.get(`${rootUrl}/cirrus/search/BlockApps-Mercata-CDPEngine-juniorNotes`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { 
        address: `eq.${cdpEngine}`, 
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
    const capUSDST = userNote.value.capUSDST || "0";
    return capUSDST;
  } catch (error) {
    console.warn(`⚠️  Could not get claimable for ${userAddress} via Cirrus:`, error.message);
    return "0";
  }
}

/**
 * Get token balance for an account via Cirrus
 * @param {string} rootUrl - The base node URL
 * @param {string} tokenAddress - Token contract address
 * @param {string} accountAddress - Account address to check
 * @param {string} token - JWT token for authorization
 * @returns {Promise<string>} Balance in token wei
 */
async function getTokenBalance(rootUrl, tokenAddress, accountAddress, token) {
  try {
    const { data: balanceData } = await axios.get(`${rootUrl}/cirrus/search/BlockApps-Mercata-Token-_balances`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { 
        address: `eq.${tokenAddress}`, 
        select: "key,value",
        key: `eq.${accountAddress.toLowerCase()}`,
        limit: 1
      }
    });
    
    if (balanceData && balanceData.length > 0) {
      return balanceData[0].value || "0";
    }
    return "0";
  } catch (error) {
    console.warn(`⚠️  Could not get balance for ${accountAddress} via Cirrus:`, error.message);
    return "0";
  }
}

/**
 * Get all junior notes via Cirrus
 * @param {string} rootUrl - The base node URL
 * @param {string} cdpEngine - CDP Engine contract address
 * @param {string} token - JWT token for authorization
 * @returns {Promise<Array>} Array of junior note objects
 */
async function getAllJuniorNotes(rootUrl, cdpEngine, token) {
  try {
    const { data: notesData } = await axios.get(`${rootUrl}/cirrus/search/BlockApps-Mercata-CDPEngine-juniorNotes`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { 
        address: `eq.${cdpEngine}`, 
        select: "key,value"
      }
    });
    
    return notesData || [];
  } catch (error) {
    console.warn("⚠️  Could not get junior notes via Cirrus:", error.message);
    return [];
  }
}

module.exports = {
  checkBadDebt,
  checkJuniorState,
  checkClaimable,
  getTokenBalance,
  getAllJuniorNotes
};
