// Quick Bad Debt Check via Cirrus
// Tests the Cirrus approach for reading bad debt data

const axios = require("axios");
require("dotenv").config();

(async () => {
  const ACC1_TOKEN = process.env.ACC1_TOKEN;
  const CDP_ENGINE = process.env.CDP_ENGINE;
  
  if (!ACC1_TOKEN) throw new Error("ACC1_TOKEN JWT required");
  if (!CDP_ENGINE) throw new Error("CDP_ENGINE address required in .env");

  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  
  console.log(`🔍 Checking Bad Debt for CDP Engine: ${CDP_ENGINE}`);
  console.log(`🌐 Node: ${ROOT}`);
  
  try {
    // Method 1: Check main contract state
    console.log("\n📊 Method 1: Main Contract State");
    const { data: contractData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-CDPEngine`, {
      headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
      params: { 
        address: `eq.${CDP_ENGINE}`, 
        select: "juniorIndex,totalJuniorOutstandingUSDST,feeToReserveBps,juniorPremiumBps", 
        limit: 1 
      }
    });
    
    if (contractData && contractData.length > 0) {
      const state = contractData[0];
      console.log(`✅ Contract found:`);
      console.log(`   Junior Index: ${state.juniorIndex || 0}`);
      console.log(`   Total Outstanding: ${state.totalJuniorOutstandingUSDST || 0}`);
      console.log(`   Fee to Reserve BPS: ${state.feeToReserveBps || 0}`);
      console.log(`   Junior Premium BPS: ${state.juniorPremiumBps || 0}`);
    } else {
      console.log("❌ No contract state found");
    }

    // Method 2: Check bad debt mapping
    console.log("\n💸 Method 2: Bad Debt Mapping");
    const { data: badDebtData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-CDPEngine-badDebtUSDST`, {
      headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
      params: { 
        address: `eq.${CDP_ENGINE}`, 
        select: "key,value",
        "value": "gt.0" // Only get entries where bad debt > 0
      }
    });
    
    if (badDebtData && badDebtData.length > 0) {
      console.log(`✅ Bad debt entries found: ${badDebtData.length}`);
      let totalBadDebt = 0;
      
      badDebtData.forEach((entry, i) => {
        console.log(`   Entry ${i + 1}:`);
        console.log(`     Key (Asset): ${entry.key}`);
        console.log(`     Value (Bad Debt): ${entry.value}`);
        
        if (typeof entry.value === 'string' || typeof entry.value === 'number') {
          totalBadDebt += Number(entry.value);
        } else if (entry.value && typeof entry.value === 'object') {
          // Handle nested object structure
          const debtValue = entry.value.badDebtUSDST || entry.value;
          if (typeof debtValue === 'string' || typeof debtValue === 'number') {
            totalBadDebt += Number(debtValue);
          }
        }
      });
      
      console.log(`📊 Total Bad Debt: ${totalBadDebt}`);
    } else {
      console.log("❌ No bad debt found");
    }

    // Method 3: Check junior notes mapping
    console.log("\n📝 Method 3: Junior Notes Mapping");
    const { data: notesData } = await axios.get(`${ROOT}/cirrus/search/BlockApps-Mercata-CDPEngine-juniorNotes`, {
      headers: { Authorization: `Bearer ${ACC1_TOKEN}` },
      params: { 
        address: `eq.${CDP_ENGINE}`, 
        select: "key,value",
        limit: 100 
      }
    });
    
    if (notesData && notesData.length > 0) {
      console.log(`✅ Junior notes found: ${notesData.length}`);
      notesData.forEach((entry, i) => {
        console.log(`   Note ${i + 1}:`);
        console.log(`     Key (Owner): ${entry.key}`);
        console.log(`     Value:`, JSON.stringify(entry.value, null, 2));
      });
    } else {
      console.log("📝 No junior notes found");
    }

    console.log("\n🎉 Bad Debt Check Complete!");

  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
})();
