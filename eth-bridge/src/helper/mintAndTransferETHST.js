const { parse } = require("dotenv");
const {
  contractName,
  NODE_ENV,
  prodStratsAddress,
  testnetStratsAddress,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
  baUsername
} = require("../config");
const axios = require("axios");

const baseUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl

function uid(prefix = '', digits = 6) {
  if (digits < 1) digits = 1;
  if (digits > 16) digits = 16;
  const random = Math.floor(Math.random() * (10 ** digits));
  return prefix ? `${prefix}_${random}` : `${random}`;
}

async function fetchParallelTransaction(token, payload) {
  const response = await axios.post(
    `https://${baseUrl}/strato/v2.3/transaction/parallel?resolve=true`,
    payload,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    }
  );

  return response;
}

function createTransactionObject(contractAddress, toAddress, toCommonName, value, txHash) {
  return {
    payload: {
      contractName,
      contractAddress,
      method: "mintETHST",
      args: {
        userAddress: toAddress,
        userCommonName: toCommonName,
        amount: value,
        txHash: txHash
      },
    },
    type: "FUNCTION",
  };
}

async function createTransactionPayload(token, transactions) {
  try {
    let ETHBridgeContract;
    try {
      ETHBridgeContract = await getAdminEthBridgeContractAddress(token);
    } catch (error) {
      console.error("Error fetching ETHBridge contracts:", error);
      throw new Error("Failed to fetch ETHBridge contracts");
    }

    const txs = [];

    for (const transaction of transactions) {
      const txHash = uid('TX', 12);
      
      const txObject = createTransactionObject(
        ETHBridgeContract[0].address,
        transaction.toAddress,
        transaction.value,
        txHash
      );

      txs.push(txObject);
    }

    const payload = {
      txs: txs,
      txParams: {
        gasLimit: 32100000000,
        gasPrice: 1,
      },
    };

    let response;
    try {
      response = await fetchParallelTransaction(token, payload);
    } catch (error) {
      console.error("Error executing fetchParallelTransaction:", error);
      throw new Error("Failed to execute transaction");
    }

    return response;
  } catch (error) {
    console.error(`Error processing transactions:`, error);

    const failedResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: error.message }),
      text: async () => error.message,
    };
    return failedResponse;
  }
}

async function getAdminEthBridgeContractAddress(token) {
  const domain = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;
  const originAddress = NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress;
  const url = `https://${domain}/cirrus/search/BlockApps-Mercata-Bridge`;

  const queryParams = new URLSearchParams({
    ownerCommonName: `eq.${baUsername}`,
    // originAddress: `eq.${originAddress}`,
    status: 'eq.1',
    token: 'eq.ETHST'
    // select: 'address,quantity',
    // order: 'block_timestamp.desc',
    // quantity: 'neq.0'
  });

  const fullUrl = `${url}?${queryParams}`;

  try {
    const response = await axios.get(fullUrl, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }
    });

    if (response.status !== 200) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.data;
    return body;
  } catch (error) {
    console.error("Error fetching admin STRATS contract addresses:", error);
    throw error;
  }
}

module.exports = {
  createTransactionPayload
};
