const { getStratsAddress, contractName } = require("../config");

async function createTransactionPayload(
  token,
  toAddress = "313d092740e9b662166bc3a614113cb65aae9078",
  value = 100
) {
  const payload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress: getStratsAddress(),
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

  const response = await fetch(
    `https://marketplace.mercata-testnet2.blockapps.net/strato/v2.3/transaction`,
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

module.exports = { createTransactionPayload };
