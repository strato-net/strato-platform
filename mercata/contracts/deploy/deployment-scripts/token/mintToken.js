const { callListAndWait, getEnvVar, saveCallListTXDataAsFile } = require("../../util");

// Mint an ERC20 Token that implements Mercata Token.sol
async function mintToken(tokenAddress, toAddress, amountWei) {
  if (!tokenAddress || !toAddress || !amountWei) {
    throw new Error("TOKEN_ADDRESS, TO_ADDRESS and AMOUNT_WEI are required");
  }
  const callListArgs = [
    {
      contract: { address: tokenAddress, name: "Token" },
      method: "mint",
      args: { to: toAddress, amount: amountWei },
    },
  ];

  const [result] = await callListAndWait(callListArgs);
  console.log("Mint result:", JSON.stringify(result, null, 2));

  saveCallListTXDataAsFile({
    operation: "Mint",
    timestamp: new Date().toISOString(),
    tokenAddress,
    toAddress,
    amountWei,
    transactionHash: result.hash,
    status: result.status,
  });
}

// CLI usage via env vars so we can pipe multiple runs easily
if (require.main === module) {
  (async () => {
    try {
      const TOKEN_ADDRESS = getEnvVar("TOKEN_ADDRESS");
      const TO_ADDRESS = getEnvVar("TO_ADDRESS");
      const AMOUNT_WEI = getEnvVar("AMOUNT_WEI");
      await mintToken(TOKEN_ADDRESS, TO_ADDRESS, AMOUNT_WEI);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}

module.exports = { mintToken }; 