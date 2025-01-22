const {
  contractName,
  NODE_ENV,
  prodUSDSTAddress,
  testnetUSDSTAddress,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
  baUsername
} = require("../config");
const axios = require("axios");
const BigNumber = require("bignumber.js");

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
        _price: 1 / 1e18,
        _quantity: value,
        _transferNumber: parseInt(uid()),
      },
    },
    type: "FUNCTION",
  };
}

async function createTransactionPayload(token, transactions) {
  try {
    // Fetch USDST contracts once outside the loop
    let USDSTContracts;
    try {
      USDSTContracts = await getAdminUSDSTContractAddress(token);
    } catch (error) {
      console.error("Error fetching USDST contracts:", error);
      throw new Error("Failed to fetch USDST contracts");
    }

    // Create a copy of USDSTContracts to track remaining quantities
    const remainingAssets = USDSTContracts?.map((asset) => ({
      address: asset.address,
      quantity: new BigNumber(asset.quantity),
    }));

    const txs = [];

    for (const transaction of transactions) {
      const USDSTAssetAddressesToUse = [];
      let remainingValue = transaction.value;

      for (const asset of remainingAssets) {
        if (remainingValue.isLessThanOrEqualTo(new BigNumber(0))) break;

        if (asset.quantity.isGreaterThan(new BigNumber(0))) {
          const quantityToUse = asset.quantity.isLessThan(remainingValue)
            ? asset.quantity
            : remainingValue;
          USDSTAssetAddressesToUse.push({
            address: asset.address,
            quantity: quantityToUse,
          });

          // Deduct the allocated quantity from the asset's remaining quantity
          asset.quantity -= quantityToUse;
          remainingValue -= quantityToUse;
        }
      }

      if (remainingValue.isGreaterThan(new BigNumber(0))) {
        throw new Error(
          `Not enough USDST to cover the transaction for ${transaction.toAddress}`
        );
      }

      // Create transaction objects and add them to the txs array
      const txObjects = USDSTAssetAddressesToUse?.map((USDST) =>
        createTransactionObject(
          USDST.address,
          transaction.toAddress,
          USDST.quantity.toFixed(0)
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

async function getAdminUSDSTContractAddress(token) {
  const domain = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;
  const originAddress = NODE_ENV === "prod" ? prodUSDSTAddress : testnetUSDSTAddress;
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
    console.error("Error fetching admin USDST contract addresses:", error);
    throw error;
  }
}

module.exports = {
  createTransactionPayload
};
