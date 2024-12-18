import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";
import axios from "axios";

async function submitPrice(token, contract, args) {
  const callArgs = {
    contract,
    method: "submitPrice",
    args: util.usc(args),
  };
  await rest.call(token, callArgs, { config });
}

async function distributeRewards(token, contract, args) {
  const callArgs = {
    contract,
    method: "distributeRewards",
    args: util.usc(args),
  };
  await rest.call(token, callArgs, { config });
}

// Function to fetch all escrow addresses for a given reserve and call distributeRewards
async function fetchAndSubmitEscrowAddresses(oracleContract, token) {
  const reserveSearchOptions = {
    config,
    query: {
      creator: "eq.BlockApps",
      isActive: "eq.true",
      oracle: "eq." + oracleContract.address,
    },
  };

  const reserves = await rest.search(
    token,
    { name: "BlockApps-Mercata-Reserve" },
    reserveSearchOptions
  );

  if (!reserves || reserves.length === 0) {
    throw new Error("No reserves found");
  }

  for (const reserve of reserves) {
    const reserveName = reserve.name;
    const reserveAddress = reserve.address;
    console.log(`Processing reserve: ${reserveName}`);
    console.log(`Reserve Address: ${reserveAddress}`);

    // Define search options for active escrows
    const searchOptions = {
      config,
      query: {
        creator: "eq.BlockApps",
        isActive: "eq.true",
        reserve: "eq." + reserveAddress,
      },
    };

    // Fetch escrows from Cirrus
    const escrows = await rest.search(
      token,
      { name: "BlockApps-Mercata-Escrow" },
      searchOptions
    );

    if (!escrows || escrows.length === 0) {
      console.log(`No escrows found for reserve ${reserveName}`);
      await distributeRewards(
        token,
        { address: reserveAddress, name: reserveName },
        { escrowAddresses: [] }
      );
      continue;
    }

    // Extract escrow addresses in batches of 20
    const batchSize = 20;
    for (let i = 0; i < escrows.length; i += batchSize) {
      const batch = escrows.slice(i, i + batchSize);
      const escrowAddresses = batch.map((escrow) => escrow.address);
      console.log(
        `Escrow Addresses for ${reserveName} (batch ${
          i / batchSize + 1
        }): ${JSON.stringify(escrowAddresses)}`
      );

      await distributeRewards(
        token,
        { address: reserveAddress, name: reserveName },
        { escrowAddresses }
      );
    }
    console.log(
      `Escrow Addresses submitted for ${reserveName} at ${new Date().toISOString()}`
    );
  }
}

// Function to fetch and submit price
async function fetchAndSubmitMetalPrice(metal, apiKey, oracleContract, token) {
  try {
    const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=${metal}&api_key=${apiKey}&currency=USD&unit=toz`;
    const response = await axios.get(apiUrl);
    const metalPrice = response.data.rate.price;
    console.log(`Current ${metal} Price: $${metalPrice} per ounce`);

    const timestampInSeconds = Math.floor(Date.now() / 1000);
    console.log(`Current Timestamp: ${timestampInSeconds}`);

    await submitPrice(token, oracleContract, {
      price: metalPrice,
      timestamp: timestampInSeconds,
    });
    console.log(`Price submitted for ${metal} at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`ERROR: Failed to submit price for ${metal}:`, error);
  }
}

// Function to fetch and submit ETH price
async function fetchAndSubmitETHPrice(
  metal,
  apiKey,
  oracleContract,
  token,
  fetchInterval
) {
  try {
    const apiUrl = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;

    // Current time in milliseconds
    const currentTimeMs = Date.now();

    // Define the request body
    const requestBody = {
      symbol: metal, // Metal or token symbol (e.g., "ETH")
      startTime: Math.floor((currentTimeMs - fetchInterval) / 1000), // Convert ms to seconds
      endTime: Math.floor(currentTimeMs / 1000), // Convert ms to seconds
      interval: "5m", // 5-minute intervals
    };

    // Make the POST request with the body
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    const responseData = response.data;

    // Validate the response data structure
    if (!responseData?.data || !Array.isArray(responseData.data)) {
      console.error("Invalid response format:", responseData);
      throw new Error("Invalid price data format from API");
    }

    // Parse the data and convert timestamps and prices
    const prices = responseData.data.map(({ value, timestamp }) => ({
      price: parseFloat(value), // Convert string to float
      timestamp: new Date(timestamp).getTime() / 1000, // Convert to seconds
    }));

    // Validate price data
    prices.forEach((point, index) => {
      if (!Number.isFinite(point.price) || point.price <= 0) {
        throw new Error(`Invalid price at index ${index}: ${point.price}`);
      }
      if (!Number.isFinite(point.timestamp) || point.timestamp <= 0) {
        throw new Error(
          `Invalid timestamp at index ${index}: ${point.timestamp}`
        );
      }
    });

    // Calculate TWAP
    const twap = calculateTWAP(prices);

    console.log(`Calculated TWAP: $${twap}`);

    // Submit TWAP price to the Oracle contract
    const currentTimestamp = Math.floor(currentTimeMs / 1000);
    await oracleContract.submitPrice(token, oracleContract, {
      price: twap,
      timestamp: currentTimestamp,
    });

    console.log(
      `TWAP submitted: $${twap.toFixed(2)} at ${new Date(
        currentTimeMs
      ).toISOString()}`
    );
  } catch (error) {
    console.error("ETH TWAP calculation and submission failed:", error);
    throw error; // Re-throw for upstream handling
  }
}

// Helper Function to Calculate TWAP
function calculateTWAP(prices) {
  let totalWeightedPrice = 0;
  let totalWeight = 0;

  for (let i = 1; i < prices.length; i++) {
    const price = prices[i].price;
    const timeDiff = prices[i].timestamp - prices[i - 1].timestamp;

    totalWeightedPrice += price * timeDiff;
    totalWeight += timeDiff;
  }

  if (totalWeight === 0) {
    throw new Error("Invalid data for TWAP calculation");
  }

  return totalWeightedPrice / totalWeight;
}

// ------------------------------------------------------------------------------------------------

// Main function to handle periodic fetching and submission
async function main() {
  assert.isDefined(
    process.env.METALS_API_KEY,
    "API key for metals API is missing. Set in .env"
  );
  assert.isDefined(
    process.env.ALCHEMY_API_KEY,
    "API key for Alchemy API is missing. Set in .env"
  );

  const { contracts } = deployment;

  const fetchInterval = Number(config.fetchInterval) || 60000; // Default to 1 minute

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const submitPricePeriodically = async () => {
    const token = await oauthHelper.getServiceToken();

    for (const [key, oracle] of Object.entries(contracts)) {
      console.log(`Processing oracle: ${key}`);

      // Ensure the oracle contract has the necessary structure
      if (!oracle.metal || !oracle.address) {
        console.warn(`WARN: Skipping invalid oracle ${key}`);
        continue;
      }

      try {
        const metal = oracle.metal.toLowerCase();
        console.log(`Fetching price for ${metal}`);

        if (metal === "ETH") {
          await fetchAndSubmitETHPrice(
            metal,
            process.env.ALCHEMY_API_KEY,
            oracle,
            token,
            fetchInterval
          );
        } else {
          await fetchAndSubmitMetalPrice(
            metal,
            process.env.METALS_API_KEY,
            oracle,
            token
          );
        }
        await fetchAndSubmitEscrowAddresses(oracle, token);
      } catch (error) {
        console.error(`ERROR: Failed to process oracle ${key}:`, error);
      }
    }
  };

  while (true) {
    await submitPricePeriodically(); // Immediate first run
    console.log(`Sleeping for ${fetchInterval} ms`);
    await sleep(fetchInterval);
  }
}

main();
