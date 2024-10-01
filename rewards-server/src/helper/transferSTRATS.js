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

function uid(prefix = '', digits = 6) {
  if (digits < 1) digits = 1;
  if (digits > 16) digits = 16;
  const random = Math.floor(Math.random() * (10 ** digits));
  return prefix ? `${prefix}_${random}` : `${random}`;
}

async function fetchParallelTransaction(token, payload) {
  const url = `https://${NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl}/strato/v2.3/transaction/parallel?resolve=true`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

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
  const results = [];

  for (const transaction of transactions) {
    try {
      // Wrap API calls in try-catch blocks to handle potential failures
      let STRATSContracts;
      try {
        STRATSContracts = await getAdminStratsContractAddress(token);
      } catch (error) {
        console.error("Error fetching STRATS contracts:", error);
        throw new Error("Failed to fetch STRATS contracts");
      }

      const stratsAssetAddressesToUse = [];

      let remainingValue = transaction.value;

      for (const asset of STRATSContracts) {
        if (remainingValue <= 0) break;

        const quantityToUse = Math.min(asset.quantity, remainingValue);
        stratsAssetAddressesToUse.push({
          address: asset.address,
          quantity: quantityToUse,
        });

        remainingValue -= quantityToUse;
      }

      if (remainingValue > 0) {
        throw new Error("Not enough STRATS to cover the transaction");
      }

      const payload = {
        txs: stratsAssetAddressesToUse.map((strats) =>
          createTransactionObject(strats.address, transaction.toAddress, strats.quantity)
        ),
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

      results.push(response);
    } catch (error) {
      console.error(`Error processing transaction to ${transaction.toAddress}:`, error);

      // Create a failed response object to include in the results
      const failedResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: error.message }),
        text: async () => error.message,
      };
      results.push(failedResponse);
    }
  }

  // Combine all responses into a single response object
  const combinedResponse = {
    ok: results.every((r) => r.ok),
    status: results.every((r) => r.ok) ? 200 : 400,
    statusText: results.every((r) => r.ok) ? "OK" : "Bad Request",
    json: async () => {
      const jsonResults = await Promise.all(results.map((r) => r.json()));
      return jsonResults.flat();
    },
    text: async () => {
      const textResults = await Promise.all(results.map((r) => r.text()));
      return textResults.join("\n");
    },
  };

  return combinedResponse;
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
