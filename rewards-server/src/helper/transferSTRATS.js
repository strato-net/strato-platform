const {
  contractName,
  NODE_ENV,
  prodStratsAddress,
  testnetStratsAddress,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");

async function createTransactionPayload(token, toAddress, value) {
  const payload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress:
            NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress,
          method: "transfer",
          args: {
            _to: toAddress,
            _value: value,
          },
        },
        type: "FUNCTION",
      },
    ],
    txParams: {
      gasLimit: 32100000000,
      gasPrice: 1,
    },
  };

  // This needs to use the parallel endpoint to resolve transactions that might go at the same time (i.e buyer and seller rewards)
  const response = await fetch(
    `https://${
      NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
    }/strato/v2.3/transaction/parallel?resolve=true`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  return response;
}

async function createTwoTransactionPayload(token, toAddress1, toAddress2, value1, value2) {
  const payload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress:
            NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress,
          method: "transfer",
          args: {
            _to: toAddress1,
            _value: value1,
          },
        },
        type: "FUNCTION",
      },
      {
        payload: {
          contractName,
          contractAddress:
            NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress,
          method: "transfer",
          args: {
            _to: toAddress2,
            _value: value2,
          },
        },
        type: "FUNCTION",
      },
    ],
    txParams: {
      gasLimit: 32100000000,
      gasPrice: 1,
    },
  };

  // This needs to use the parallel endpoint to resolve transactions that might go at the same time (i.e buyer and seller rewards)
  const response = await fetch(
    `https://${
      NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
    }/strato/v2.3/transaction/parallel?resolve=true`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  return response;
}

module.exports = { createTransactionPayload,  createTwoTransactionPayload};
