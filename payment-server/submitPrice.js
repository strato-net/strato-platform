import axios from "axios";
import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import http from "http";

import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";
import flagFile from "./helpers/flagFile.js";

// Global array to store all distributeRewards calls
const distributeRewardsCallList = [];

// Function to submit price to the oracle contract
async function submitPrice(token, contract, args) {
  const callArgs = {
    contract,
    method: "submitPrice",
    args: util.usc(args),
  };
  await rest.call(token, callArgs, { config, cacheNonce: true });
}

// Function to update the price of the Asset Sale price
async function updateMetalPrice(assetName, token, contractAddress, price) {
  const priceMarkup =
    (assetName === "gold"
      ? process.env.GOLD_PRICE_MARKUP
      : process.env.SILVER_PRICE_MARKUP) || "1"; // Default to "1" if undefined
  const parsedPriceMarkup = parseFloat(priceMarkup);
  const callArgs = {
    contract: {
      address: contractAddress,
    },
    method: "update",
    args: {
      _quantity: 0,
      _price: Math.round(price * parsedPriceMarkup * 100) / 100,
      _paymentServices: [{ creator: "", serviceName: "" }],
      _scheme: 2,
    },
  };
  await rest.call(token, callArgs, { config, cacheNonce: true });
}

// Instead of calling rest.call directly, accumulate call arguments for distributeRewards
async function distributeRewards(token, contract, args) {
  const callArgs = {
    contract,
    method: "distributeRewards",
    args: util.usc(args),
  };
  // Push call arguments into the global array
  distributeRewardsCallList.push(callArgs);
}

// After all calls are collected, we run them at once
async function runDistributeRewardsCalls(token) {
  if (distributeRewardsCallList.length > 0) {
    console.log("Executing batch callList for distributeRewards...");
    let res;
    try {
      res = await rest.callList(token, distributeRewardsCallList, {
        config,
        cacheNonce: true,
        isAsync: true,
      });
      // wait until there are no more PENDING results
      const predicate = (results) =>
        results.filter((r) => r.status === rest.PENDING).length === 0;
      const action = async () =>
        rest.getBlocResults(
          token,
          res.map((r) => r.hash),
          { config }
        );
      await util.until(predicate, action, { config }, 3600000);
      console.log("Batch distributeRewards calls completed.");
    } catch (error) {
      console.error("Error executing batch distributeRewards calls:", error);
      console.log(
        "The hashes of distribute rewards transactions in a failed batch:",
        res.map((r) => r.hash)
      );
      await flagFile.appendToErrorFile(
        `Error executing batch distributeRewards calls: ${error}`
      );
    }
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
      // Collect callArgs for empty escrowAddresses to distributeRewards
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

      // Collect callArgs instead of calling directly
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
async function fetchMetalPrice(metal, apiKey) {
  try {
    const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=${metal}&api_key=${apiKey}&currency=USD&unit=toz`;
    const response = await axios.get(apiUrl);
    const metalPrice = response.data.rate.price;
    console.log(`Current ${metal} Price: $${metalPrice} per ounce`);

    const timestampInSeconds = Math.floor(Date.now() / 1000);
    console.log(`Current Timestamp: ${timestampInSeconds}`);

    return { price: metalPrice, timestampInSeconds };
  } catch (error) {
    console.error(`ERROR: Failed to fetch price for ${metal}:`, error);
    await flagFile.appendToErrorFile(
      `Failed to fetch price for ${metal}: ${error}`
    );
  }
}

// Function to fetch and submit ETH price
async function fetchAndSubmitETHPrice(
  metal,
  apiKey,
  oracleContract,
  token,
  oracleInterval
) {
  try {
    const apiUrl = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;

    // Current time in milliseconds
    const currentTimeMs = Date.now();

    // Define the request body
    const requestBody = {
      symbol: metal,
      startTime: Math.floor((currentTimeMs - oracleInterval) / 1000),
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
    await submitPrice(token, oracleContract, {
      price: twap / 1e18,
      timestamp: currentTimestamp,
    });

    console.log(
      `TWAP submitted: $${twap.toFixed(2)} at ${new Date(
        currentTimeMs
      ).toISOString()}`
    );
  } catch (error) {
    console.error("ETH TWAP calculation and submission failed:", error);
    await flagFile.appendToErrorFile(
      `ETH TWAP calculation and submission failed: ${error}`
    );
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

// Function to submit oracle prices periodically
const submitOraclePricePeriodically = async (oracleInterval) => {
  const token = await oauthHelper.getServiceToken();

  for (const [key, oracle] of Object.entries(deployment.contracts)) {
    console.log(`[Oracle Update] Processing oracle: ${key}`);

    if (!oracle.metal || !oracle.address) {
      console.warn(`[Oracle WARN] Skipping invalid oracle ${key}`);
      continue;
    }

    try {
      if (oracle.metal === "ETH") {
        await fetchAndSubmitETHPrice(
          oracle.metal,
          process.env.ALCHEMY_API_KEY,
          oracle,
          token,
          oracleInterval
        );
      } else if (oracle.metal === "USD") {
        await submitPrice(token, oracle, {
          price: 1 / 1e18,
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        const metalResult = await fetchMetalPrice(
          oracle.metal.toLowerCase(),
          process.env.METALS_API_KEY
        );

        if (metalResult) {
          await submitPrice(token, oracle, {
            price: metalResult.price,
            timestamp: metalResult.timestampInSeconds,
          });
          console.log(
            `[Oracle Update] Price submitted for ${
              oracle.metal
            } at ${new Date().toISOString()}`
          );
        }
      }

      await fetchAndSubmitEscrowAddresses(oracle, token);
    } catch (error) {
      console.error(`[Oracle ERROR] Failed to process oracle ${key}:`, error);
      await flagFile.appendToErrorFile(
        `Failed to process oracle ${key}: ${error}`
      );
    }
  }

  await runDistributeRewardsCalls(token);
};

// Function to update sale prices periodically
const updateSalePricePeriodically = async () => {
  const token = await oauthHelper.getUserToken(
    process.env.METALS_USERNAME,
    process.env.METALS_PASSWORD
  );
  for (const asset of config.assets) {
    const addresses =
      asset && typeof asset.addresses === "string" && asset.addresses.trim()
        ? asset.addresses.split(",")
        : [];
    for (const address of addresses) {
      try {
        const searchOptions = {
          config,
          query: {
            address: "eq." + address,
            select: "sale,name",
          },
        };

        const assetResult = await rest.search(
          token,
          { name: "BlockApps-Mercata-Asset" },
          searchOptions
        );

        if (!assetResult[0]?.sale) {
          console.warn(`[Sale Update] Skipping invalid asset ${address}`);
          continue;
        }

        const metalResult = await fetchMetalPrice(
          asset.name.toLowerCase(),
          process.env.METALS_API_KEY
        );

        await updateMetalPrice(
          asset.name.toLowerCase(),
          token,
          assetResult[0]?.sale,
          assetResult[0]?.name.toLowerCase().includes("gold")
            ? metalResult.price / 100
            : metalResult.price
        );
        console.log(
          `[Sale Update] Price updated for asset: ${address} at ${new Date().toISOString()}`
        );
      } catch (error) {
        console.error(
          `[Sale ERROR] Failed to update sale price for asset ${address}:`,
          error
        );
        await flagFile.appendToErrorFile(
          `Failed to update sale price for asset ${address}: ${error}`
        );
      }
    }
  }
};

// Main function to run the tasks concurrently
async function main() {
  assert.isDefined(
    process.env.METALS_API_KEY,
    "API key for metals API is missing. Set in .env"
  );
  assert.isDefined(
    process.env.ALCHEMY_API_KEY,
    "API key for Alchemy API is missing. Set in .env"
  );

  const oracleInterval = Number(config.oracleInterval) || 60000; // Default: 1 minute
  const saleInterval = Number(config.saleInterval) || 60000; // Default: 1 minute
  const totalRunInterval = 60 * 1000; // 1 minutes
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let lastOracleRun = 0;
  let lastSaleRun = 0;

  const heartbeatServer = http.createServer(async (_, res) => {
    const errorFlagRaised = await flagFile.isErrorFlagRaised();
    if (!errorFlagRaised) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "pong" }));
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message: "server error, check errors",
        })
      );
    }
  });
  const port = process.env.PORT || 8018;
  heartbeatServer.listen(port, () => {
    console.log(`Heartbeat server started on port ${port}.`);
  });

  // Periodically fetch prices and update
  const runTasks = async () => {
    while (true) {
      try {
        // Check if it's time to run the oracle update
        if (Date.now() - lastOracleRun >= oracleInterval) {
          console.log("[Oracle] Running submitOraclePricePeriodically...");
          await submitOraclePricePeriodically(oracleInterval);
          lastOracleRun = Date.now();
        } else {
          console.log("[Oracle] Skipping since interval not reached.");
        }

        // Check if it's time to run the sale price update
        if (Date.now() - lastSaleRun >= saleInterval) {
          console.log("[Sale] Running updateSalePricePeriodically...");
          await updateSalePricePeriodically();
          lastSaleRun = Date.now();
        } else {
          console.log("[Sale] Skipping since interval not reached.");
        }
      } catch (error) {
        console.error("Error in main loop:", error);
        await flagFile.appendToErrorFile(`Error in main loop: ${error}`);
      } finally {
        // Sleep to ensure the loop runs approximately every 1 minutes
        console.log(
          `Sleeping for ${totalRunInterval / 1000} seconds until next cycle...`
        );
        await sleep(totalRunInterval);
      }
    }
  };

  await runTasks();
}

await main();
