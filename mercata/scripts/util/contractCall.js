const axios = require("axios");

const contractCall = async (
  contractName,
  contractAddress,
  method,
  args,
  adminToken = null
) => {
  // Use provided token or fall back to env var
  const accessToken = adminToken || process.env.ADMIN_TOKEN;
  if (!accessToken) {
    throw new Error("ADMIN_TOKEN required for contract calls");
  }

  const nodeUrl = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!nodeUrl) {
    throw new Error("NODE_URL or STRATO_NODE_URL required");
  }

  const BASE = nodeUrl.includes("/strato/") ? nodeUrl : `${nodeUrl}/strato/v2.3`;

  const txPayload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress,
          method,
          args,
        },
        type: "FUNCTION",
      },
    ],
    txParams: {
      gasLimit: 32100000000,
      gasPrice: 1,
    },
  };

  let response;
  try {
    response = await axios.post(
      `${BASE}/transaction/parallel?resolve=true`,
      txPayload,
      {
        headers: {
          accept: "application/json;charset=utf-8",
          "content-type": "application/json;charset=utf-8",
          authorization: `Bearer ${accessToken}`,
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      }
    );

    if (response.status !== 200) {
      throw new Error(`Strato error: ${response.statusText}`);
    }
  } catch (error) {
    // Handle blockchain errors and preserve the original error message
    if (error.response?.status === 422) {
      const errorData = error.response.data;
      
      if (errorData && typeof errorData === 'string') {
        // Look for Solidity error messages in the response
        const solidityMatch = errorData.match(/SString "([^"]+)"/);
        
        if (solidityMatch) {
          console.log("Solidity error in contract call:", solidityMatch[1]);
          throw new Error(solidityMatch[1]); // Throw just the original blockchain error
        }
      }
    }
    throw error; // Re-throw other errors
  }

  if (!response.data || !Array.isArray(response.data)) {
    throw new Error("Strato response data is empty or invalid");
  }

  const result = response.data[0];
  if (!result) {
    throw new Error("Missing transaction result");
  }

  // Check if the transaction failed
  if (result.status === "Failure") {
    const errorMsg = result.txResult?.message || result.error || "Transaction failed";
    throw new Error(errorMsg);
  }

  return result;
};

// Helper for read-only contract calls
const contractCallView = async (contractName, contractAddress, method, args = []) => {
  const accessToken = process.env.ADMIN_TOKEN;
  if (!accessToken) {
    throw new Error("ADMIN_TOKEN required for contract calls");
  }

  const nodeUrl = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!nodeUrl) {
    throw new Error("NODE_URL or STRATO_NODE_URL required");
  }

  const BASE = nodeUrl.includes("/strato/") ? nodeUrl : `${nodeUrl}/strato/v2.3`;
  const url = `${BASE}/contract/${contractName}/${contractAddress}/call`;
  const params = { method, args: JSON.stringify(args) };
  
  const { data } = await axios.get(url, { 
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    params 
  });
  
  return data;
};

module.exports = {
  contractCall,
  contractCallView
};
