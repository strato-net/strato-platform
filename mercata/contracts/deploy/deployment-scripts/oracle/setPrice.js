const {
  callListAndWait,
  getEnvVar,
  saveCallListTXDataAsFile,
} = require("../../util");

async function setPrice(oracleAddress, tokenAddress, priceValue) {
  if (!oracleAddress || !tokenAddress || !priceValue) {
    throw new Error(
      "Oracle address, token address, and price value are required"
    );
  }

  const callListArgs = [
    {
      contract: { address: oracleAddress, name: "PriceOracle" },
      method: "setAssetPrice",
      args: {
        asset: tokenAddress,
        price: priceValue,
      },
    },
  ];

  const results = await callListAndWait(callListArgs);
  const result = Array.isArray(results) ? results[0] : results;

  console.log("setAssetPrice result:", JSON.stringify(result, null, 2));

  // Check if the transaction was successful
  if (result.status !== "Success") {
    throw new Error(
      `Transaction failed with status: ${result.status}. Transaction hash: ${result.hash}`
    );
  }

  // Save transaction data
  const txData = {
    operation: "Set Price",
    timestamp: new Date().toISOString(),
    oracleAddress,
    tokenAddress,
    priceValue,
    transactionHash: result.hash,
    status: result.status,
  };

  saveCallListTXDataAsFile(txData);

  return result.status === "Success" ? result.hash : null;
}

async function main() {
  const requiredEnvVars = ["TOKEN_ADDRESS", "ORACLE_ADDRESS", "PRICE_VALUE"];
  const [TOKEN_ADDRESS, ORACLE_ADDRESS, PRICE_VALUE] =
    requiredEnvVars.map(getEnvVar);

  if (!TOKEN_ADDRESS || !ORACLE_ADDRESS || !PRICE_VALUE) {
    throw new Error(
      `Required environment variables: ${requiredEnvVars.join(", ")}`
    );
  }

  try {
    const txHash = await setPrice(ORACLE_ADDRESS, TOKEN_ADDRESS, PRICE_VALUE);
    console.log("Price set successfully. Transaction hash:", txHash);
  } catch (error) {
    console.error("Error setting price:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { setPrice };
