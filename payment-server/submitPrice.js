import axios from "axios";
import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import http from "http";

import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";

// Global arrays to store all calls for each method
const submitPriceCallList = [];
const distributeRewardsCallList = [];

// Helper function to collect arguments for submitPrice
async function queueSubmitPrice(token, contract, args) {
  const callArgs = {
    contract,
    method: "submitPrice",
    args: util.usc(args),
  };
  // Push call arguments into the submitPriceCallList
  submitPriceCallList.push(callArgs);
}

// Helper function to collect arguments for distributeRewards
async function queueDistributeRewards(token, contract, args) {
  const callArgs = {
    contract,
    method: "distributeRewards",
    args: util.usc(args),
  };
  // Push call arguments into the global array
  distributeRewardsCallList.push(callArgs);
}

// After collecting submitPrice calls, run them all at once
async function runSubmitPriceCalls(token) {
  if (submitPriceCallList.length > 0) {
    console.log("Executing batch callList for submitPrice...");
    await rest.callList(token, submitPriceCallList, { config });
    console.log("Batch submitPrice calls completed.");

    // Clear out the array if you want a fresh start next time
    submitPriceCallList.length = 0;
  } else {
    console.log("No submitPrice calls to execute.");
  }
}

// After collecting distributeRewards calls, run them all at once
async function runDistributeRewardsCalls(token) {
  if (distributeRewardsCallList.length > 0) {
    console.log("Executing batch callList for distributeRewards...");
    await rest.callList(token, distributeRewardsCallList, { config });
    console.log("Batch distributeRewards calls completed.");

    // Clear out the array if you want a fresh start next time
    distributeRewardsCallList.length = 0;
  } else {
    console.log("No distributeRewards calls to execute.");
  }
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
      // Queue distributeRewards with empty array
      await queueDistributeRewards(
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

      // Queue the distributeRewards call
      await queueDistributeRewards(
        token,
        { address: reserveAddress, name: reserveName },
        { escrowAddresses }
      );
    }

    console.log(
      `Escrow Addresses queued for ${reserveName} at ${new Date().toISOString()}`
    );
  }
}

// Instead of calling rest.call directly in fetchAndSubmitMetalPrice, queue the call
async function fetchAndSubmitMetalPrice(metal, apiKey, oracleContract, token) {
  try {
    const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=${metal}&api_key=${apiKey}&currency=USD&unit=toz`;
    const response = await axios.get(apiUrl);
    const metalPrice = response.data.rate.price;
    console.log(`Current ${metal} Price: $${metalPrice} per ounce`);

    const timestampInSeconds = Math.floor(Date.now() / 1000);
    console.log(`Current Timestamp: ${timestampInSeconds}`);

    // Queue the submitPrice call
    await queueSubmitPrice(token, oracleContract, {
      price: metalPrice,
      timestamp: timestampInSeconds,
    });
    console.log(`Price queued for ${metal} at ${new Date().toISOString()}`);
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
      symbol: metal,
      startTime: Math.floor((currentTimeMs - fetchInterval) / 1000),
      endTime: Math.floor(currentTimeMs / 1000),
      interval: "1h",
    };

    // Make the POST request with the body
    const response = await axios.post(apiUrl, requestBody, {
      headers: { "Content-Type": "application/json" },
    });

    const responseData = response.data;

    if (!responseData?.data || !Array.isArray(responseData.data)) {
      console.error("Invalid response format:", responseData);
      throw new Error("Invalid price data format from API");
    }

    console.log(`Received ${responseData.data.length} price points`);

    const prices = responseData.data.map(({ value, timestamp }) => ({
      price: parseFloat(value),
      timestamp: new Date(timestamp).getTime() / 1000,
    }));

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

    const twap = calculateTWAP(prices);
    console.log(`Calculated TWAP: $${twap}`);

    const currentTimestamp = Math.floor(currentTimeMs / 1000);

    // Queue the submitPrice call
    await queueSubmitPrice(token, oracleContract, {
      price: twap / 1e18,
      timestamp: currentTimestamp,
    });

    console.log(
      `TWAP queued: $${twap.toFixed(2)} at ${new Date(currentTimeMs).toISOString()}`
    );
  } catch (error) {
    console.error("ETH TWAP calculation and submission failed:", error);
    throw error;
  }
}

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
  const fetchInterval = Number(config.fetchInterval) || 60000; // Default: 1 minute
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const submitPricePeriodically = async () => {
    const token = await oauthHelper.getServiceToken();

    for (const [key, oracle] of Object.entries(contracts)) {
      console.log(`Processing oracle: ${key}`);

      if (!oracle.metal || !oracle.address) {
        console.warn(`WARN: Skipping invalid oracle ${key}`);
        continue;
      }

      try {
        const metal = oracle.metal;
        console.log(`Fetching price for ${metal}`);

        if (metal === "ETH") {
          await fetchAndSubmitETHPrice(
            metal,
            process.env.ALCHEMY_API_KEY,
            oracle,
            token,
            fetchInterval
          );
        } else if (metal === "USD") {
          await queueSubmitPrice(token, oracle, {
            price: 1 / 1e18,
            timestamp: Math.floor(Date.now() / 1000),
          });
        } else {
          await fetchAndSubmitMetalPrice(
            metal.toLowerCase(),
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

    // After processing all oracles, run the queued calls
    await runSubmitPriceCalls(token);
    await runDistributeRewardsCalls(token);
  };
  
  // Run the heartbeat ping-pong server for health check
  // TODO: in future extend this to include more health checks, e.g. if one of oracles is failing (flag rules based on global vars)
  const heartbeatServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({success: true, message: 'pong'}));
  });
  const port = process.env.PORT || 8018
  heartbeatServer.listen(port, () => {
    console.log(`Heartbeat server started on port ${port}.`);
  });
  
  while (true) {
    await submitPricePeriodically(); // Immediate first run
    console.log(`Sleeping for ${fetchInterval} ms`);
    await sleep(fetchInterval);
  }
}

main();
