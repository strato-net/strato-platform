// Quick test script to check balanceOf function call
// Required: ACC1_TOKEN (JWT), USDST address in .env

const axios = require("axios");
require("dotenv").config();

(async () => {
  // Config
  const ACC1_TOKEN = process.env.ACC1_TOKEN;
  const ACC1_ADDRESS = process.env.ACC1_ADDRESS || "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
  const USDST = process.env.USDST || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

  if (!ACC1_TOKEN) throw new Error("ACC1_TOKEN JWT required");

  // API setup - Exact same as setupCDPTest.js
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  const headers = { Authorization: `Bearer ${ACC1_TOKEN}`, "Content-Type": "application/json" };
  const buildCall = (name, addr, method, args = {}) => ({ type: "FUNCTION", payload: { contractName: name, contractAddress: addr, method, args } });

  console.log(`🔍 Testing balanceOf function call...`);
  console.log(`USDST: ${USDST}`);
  console.log(`ACC1_ADDRESS: ${ACC1_ADDRESS}`);
  console.log(`Endpoint: ${txEndpoint}`);

  try {
    // Exact same call as setupCDPTest.js line 83-84
    const balanceTx = buildCall("Token", USDST, "balanceOf", { accountAddress: ACC1_ADDRESS });
    console.log(`📋 Transaction payload:`, JSON.stringify(balanceTx, null, 2));
    
    const { data: balanceRes } = await axios.post(txEndpoint, { txs: [balanceTx] }, { headers });
    
    console.log(`📊 Raw response:`, JSON.stringify(balanceRes, null, 2));
    
    if (balanceRes[0].status !== "Success") {
      console.error(`❌ Failed to get balance: ${balanceRes[0].error || balanceRes[0].status}`);
    } else {
      const currentBalance = balanceRes[0].data?.contents?.[0] || "0";
      console.log(`✅ Balance: ${currentBalance}`);
    }

  } catch (error) {
    console.error("❌ Request failed:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
  }
})();
