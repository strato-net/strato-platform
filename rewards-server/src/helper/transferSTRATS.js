const { parse } = require("dotenv");
const {
  contractName,
  NODE_ENV,
  prodStratsAddress,
  testnetStratsAddress,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");

function uid(prefix = '', digits = 6) {
  if (digits < 1) digits = 1;
  if (digits > 16) digits = 16;
  const random = Math.floor(Math.random() * (10 ** digits));
  return prefix ? `${prefix}_${random}` : `${random}`;
}

async function createTransactionPayload(token, toAddress, value) {
  const payload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress:
            NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress,
          method: "automaticTransfer",
          args: {
            _newOwner: toAddress,
            _price: 0.0001,
            _quantity: value,
            _transferNumber: parseInt(uid()),
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
          method: "automaticTransfer",
          args: {
            _newOwner: toAddress1,
            _price: 0.0001,
            _quantity: value1,
            _transferNumber: parseInt(uid()),
          },
        },
        type: "FUNCTION",
      },
      {
        payload: {
          contractName,
          contractAddress:
            NODE_ENV === "prod" ? prodStratsAddress : testnetStratsAddress,
          method: "automaticTransfer",
          args: {
            _newOwner: toAddress2,
            _price: 0.0001,
            _quantity: value2,
            _transferNumber: parseInt(uid()),
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
