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

function createTransactionObject(contractAddress, toAddress, value) {
  return {
    payload: {
      contractName,
      contractAddress,
      method: "automaticTransfer",
      args: {
        _newOwner: toAddress,
        _price: 0.0001,
        _quantity: value,
        _transferNumber: parseInt(uid()),
      },
    },
    type: "FUNCTION",
  };
}

async function createTransactionPayload(token, transactions) {
  try {
    // Fetch STRATS contracts once outside the loop
    let STRATSContracts;
    try {
      STRATSContracts = await getAdminStratsContractAddress(token);
    } catch (error) {
      console.error("Error fetching STRATS contracts:", error);
      throw new Error("Failed to fetch STRATS contracts");
    }

    // Create a copy of STRATSContracts to track remaining quantities
    const remainingAssets = STRATSContracts.map((asset) => ({
      address: asset.address,
      quantity: asset.quantity,
    }));

    const txs = [];

    for (const transaction of transactions) {
      const stratsAssetAddressesToUse = [];
      let remainingValue = transaction.value;

      for (const asset of remainingAssets) {
        if (remainingValue <= 0) break;

        if (asset.quantity > 0) {
          const quantityToUse = Math.min(asset.quantity, remainingValue);
          stratsAssetAddressesToUse.push({
            address: asset.address,
            quantity: quantityToUse,
          });

          // Deduct the allocated quantity from the asset's remaining quantity
          asset.quantity -= quantityToUse;
          remainingValue -= quantityToUse;
        }
      }

      if (remainingValue > 0) {
        throw new Error(
          `Not enough STRATS to cover the transaction for ${transaction.toAddress}`
        );
      }

      // Create transaction objects and add them to the txs array
      const txObjects = stratsAssetAddressesToUse.map((strats) =>
        createTransactionObject(
          strats.address,
          transaction.toAddress,
          strats.quantity
        )
      );

      txs.push(...txObjects);
    }

    // Construct the payload with the aggregated txs array
    const payload = {
      txs: txs,
      txParams: {
        gasLimit: 32100000000,
        gasPrice: 1,
      },
    };

    // Make a single fetchParallelTransaction call
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

    // Return a failed response object
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

async function getAdminStratsContractAddress(token) {
  const domain = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;
  const originAddress = NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress;
  const url = `https://${domain}/cirrus/search/BlockApps-Mercata-Asset`;

  const queryParams = new URLSearchParams({
    ownerCommonName: `eq.${baUsername}`,
    originAddress: `eq.${originAddress}`,
    status: 'eq.1',
    select: 'address,quantity',
    order: 'block_timestamp.desc',
    quantity: 'neq.0'
  });

  const fullUrl = `${url}?${queryParams}`;

  try {
    const response = await fetch(fullUrl, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.json();
    return body;
  } catch (error) {
    console.error("Error fetching admin STRATS contract addresses:", error);
    throw error;
  }
}

module.exports = {
  createTransactionPayload
};
