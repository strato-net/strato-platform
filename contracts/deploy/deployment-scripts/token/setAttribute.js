const {
  callListAndWait,
  getEnvVar,
  saveCallListTXDataAsFile,
} = require("../../util");

async function setAttribute(tokenAddress, attributeKey, attributeValue) {
  if (!tokenAddress || !attributeKey || !attributeValue) {
    throw new Error(
      "Token address, attribute key, and attribute value are required"
    );
  }

  const callListArgs = [
    {
      contract: { address: tokenAddress, name: "Token" },
      method: "setAttribute",
      args: {
        key: attributeKey,
        value: attributeValue,
      },
    },
  ];

  const results = await callListAndWait(callListArgs);
  const result = Array.isArray(results) ? results[0] : results;

  console.log("setAttribute result:", JSON.stringify(result, null, 2));

  // Check if the transaction was successful
  if (result.status !== "Success") {
    throw new Error(
      `Transaction failed with status: ${result.status}. Transaction hash: ${result.hash}`
    );
  }

  // Save transaction data
  const txData = {
    operation: "Set Attribute",
    timestamp: new Date().toISOString(),
    tokenAddress,
    attributeKey,
    attributeValue,
    transactionHash: result.hash,
    status: result.status,
  };

  saveCallListTXDataAsFile(txData);

  return result.status === "Success" ? result.hash : null;
}

async function main() {
  const requiredEnvVars = ["TOKEN_ADDRESS", "ATTRIBUTE_KEY", "ATTRIBUTE_VALUE"];
  const [TOKEN_ADDRESS, ATTRIBUTE_KEY, ATTRIBUTE_VALUE] =
    requiredEnvVars.map(getEnvVar);

  if (!TOKEN_ADDRESS || !ATTRIBUTE_KEY || !ATTRIBUTE_VALUE) {
    throw new Error(
      `Required environment variables: ${requiredEnvVars.join(", ")}`
    );
  }

  try {
    const txHash = await setAttribute(
      TOKEN_ADDRESS,
      ATTRIBUTE_KEY,
      ATTRIBUTE_VALUE
    );
    console.log("Attribute set successfully. Transaction hash:", txHash);
  } catch (error) {
    console.error("Error setting attribute:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { setAttribute };
