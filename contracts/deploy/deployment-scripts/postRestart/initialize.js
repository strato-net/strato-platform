const { getEnvVar, callListAndWait } = require("../../util");
const { createPool } = require("../pool/createPool");

// Contract addresses (update as needed)
const poolFactoryAddress = "100a";
const lendingPoolAddress = "1005";
const liquidityPoolAddress = "1004";
const onRampAddress = "1009";
const USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const GOLDST_ADDRESS = "cdc93d30182125e05eec985b631c7c61b3f63ff0";
const DECIMALS = "000000000000000000";
const BA_TEST_ADDRESS = "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";

/**
 * Initialize the pool, add liquidity, and deposit liquidity into the lending pool.
 * Expects environment variables TOKEN_B_AMOUNT and MAX_TOKEN_A_AMOUNT to be set.
 */
async function initialize() {
  let poolAddr;
  try {
    // Use the deployed token as tokenA and a second token from env as tokenB
    console.log("Creating pool for USDST and GOLDST...");
    poolAddr = await createPool(
      USDST_ADDRESS, // USDST as tokenA
      GOLDST_ADDRESS, // GOLDST as tokenB
      poolFactoryAddress
    );
    console.log("Created pool at:", poolAddr);
  } catch (error) {
    console.log("createPool failed, attempting to query existing pool...");
    // Query poolFactory for an existing pool using a Cirrus call
    const poolQueryResult = await callListAndWait([
      {
        contract: { address: poolFactoryAddress, name: "PoolFactory" },
        method: "getPool", // or the appropriate view method name
        args: {
          tokenA: USDST_ADDRESS,
          tokenB: GOLDST_ADDRESS,
        },
      },
    ]);
    // Assume the query response is in poolQueryResult[0].response
    poolAddr = Array.isArray(poolQueryResult)
      ? poolQueryResult[0].data.contents[0]
      : poolQueryResult.data.contents[0];
    console.log("Queried existing pool at:", poolAddr);
  }
  return poolAddr;
}

if (require.main === module) {
  (async () => {
    const poolAddr = await initialize();

    // Add liquidity: amounts pulled from env vars
    const TOKEN_A_MINT_AMOUNT = getEnvVar("TOKEN_A_MINT_AMOUNT"); // USDST
    const TOKEN_B_MINT_AMOUNT = getEnvVar("TOKEN_B_MINT_AMOUNT"); // GOLDST
    const TOKEN_B_AMOUNT = getEnvVar("TOKEN_B_AMOUNT"); // GOLDST
    const MAX_TOKEN_A_AMOUNT = getEnvVar("MAX_TOKEN_A_AMOUNT"); // USDST
    const PAYMENT_PROVIDER_ADDRESS = getEnvVar("PAYMENT_PROVIDER_ADDRESS");
    const PAYMENT_PROVIDER_NAME = getEnvVar("PAYMENT_PROVIDER_NAME");
    const PAYMENT_PROVIDER_ENDPOINT = getEnvVar("PAYMENT_PROVIDER_ENDPOINT");
    const LISTING_MARGIN_BPS = getEnvVar("LISTING_MARGIN_BPS");
    console.log(
      `Batching addLiquidity, depositLiquidity, and on-ramp setup...`
    );
    const batchCalls = [
      {
        contract: { address: USDST_ADDRESS, name: "ERC20" },
        method: "mint",
        args: {
          to: BA_TEST_ADDRESS,
          amount: TOKEN_A_MINT_AMOUNT + DECIMALS,
        },
      },
      {
        contract: { address: GOLDST_ADDRESS, name: "ERC20" },
        method: "mint",
        args: {
          to: BA_TEST_ADDRESS,
          amount: TOKEN_B_MINT_AMOUNT + DECIMALS,
        },
      },
      {
        contract: { address: USDST_ADDRESS, name: "ERC20" },
        method: "approve",
        args: {
          spender: poolAddr,
          value: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
        },
      },
      {
        contract: { address: GOLDST_ADDRESS, name: "ERC20" },
        method: "approve",
        args: {
          spender: poolAddr,
          value: TOKEN_B_AMOUNT + DECIMALS,
        },
      },
      {
        contract: { address: poolAddr, name: "Pool" },
        method: "addLiquidity",
        args: {
          tokenB_amount: TOKEN_B_AMOUNT + DECIMALS, // 2 GOLDST
          max_tokenA_amount: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
        },
      },
      {
        contract: { address: USDST_ADDRESS, name: "ERC20" },
        method: "approve",
        args: {
          spender: liquidityPoolAddress,
          value: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
        },
      },
      {
        contract: { address: lendingPoolAddress, name: "LendingPool" },
        method: "depositLiquidity",
        args: {
          asset: USDST_ADDRESS,
          amount: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
        },
      },
      // === On-ramp setup: add payment provider, whitelist token, approve seller ===
      {
        contract: { address: onRampAddress, name: "OnRamp" },
        method: "addPaymentProvider",
        args: {
          provider: PAYMENT_PROVIDER_ADDRESS,
          name: PAYMENT_PROVIDER_NAME,
          endpoint: PAYMENT_PROVIDER_ENDPOINT,
        },
      },
      {
        contract: { address: onRampAddress, name: "OnRamp" },
        method: "setApprovedToken",
        args: {
          token: USDST_ADDRESS,
          whitelist: true,
        },
      },
      {
        contract: { address: onRampAddress, name: "OnRamp" },
        method: "setApprovedSeller",
        args: {
          seller: BA_TEST_ADDRESS,
          approved: true,
        },
      },
      {
        contract: { address: USDST_ADDRESS, name: "ERC20" },
        method: "approve",
        args: {
          spender: onRampAddress,
          value: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
        },
      },
      {
        contract: { address: onRampAddress, name: "OnRamp" },
        method: "createListing",
        args: {
          token: USDST_ADDRESS,
          amount: MAX_TOKEN_A_AMOUNT + DECIMALS, // 10000 USDST
          marginBps: LISTING_MARGIN_BPS, // 1% margin
          providerAddresses: [
            PAYMENT_PROVIDER_ADDRESS, // STRIPE
          ],
        },
      },
    ];

    const batchResults = await callListAndWait(batchCalls);

    // Log the result of each batch call, counting failures
    let failureCount = 0;
    batchResults.forEach((result, index) => {
      const call = batchCalls[index];
      if (result.status !== "Success") {
        failureCount++;
        console.log(
          `Batch call FAILED: contract ${call.contract.name} at ${call.contract.address}, method ${call.method} returned status ${result.status}. Transaction hash: ${result.hash}`
        );
      } else {
        console.log(
          `Batch call succeeded: contract ${call.contract.name} at ${call.contract.address}, method ${call.method}, transaction hash: ${result.hash}`
        );
      }
    });

    if (failureCount > 0) {
      console.log(
        `${failureCount} out of ${batchResults.length} batch calls failed.`
      );
    } else {
      console.log("All batch transactions completed successfully.");
    }
  })();
}

// Add this at the end of the file
module.exports = {
  initialize,
};
