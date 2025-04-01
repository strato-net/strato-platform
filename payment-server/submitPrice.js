import fs from "fs";
import axios from "axios";
import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import http from "http";
import BigNumber from "bignumber.js";

import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";
import flagFile from "./helpers/flagFile.js";

const oracleConfigPath = "/tmp/oracle.json";
if (!fs.existsSync(oracleConfigPath)) {
  throw new Error(`Oracle configuration file not found at ${oracleConfigPath}`);
}

let oracleConfig;
try {
  oracleConfig = JSON.parse(fs.readFileSync(oracleConfigPath, "utf8"));
} catch (error) {
  // Log error to flag file and/or throw an error with a clear message
  await flagFile.appendToErrorFile(
    `Failed to parse oracle.json file: ${error.message}`
  );
  throw new Error(`Failed to parse oracle.json file: ${error.message}`);
}

// Destructure with defaults
const {
  oracleUpdateTime: rawOracleUpdateTime,
  saleUpdateTime: rawSaleUpdateTime,
  assets: configAssets = [],
} = oracleConfig;

// Set defaults
let saleUpdateTime = 13; // Default: 13:00 UTC
let assets = [];
let oracleUpdateTime = 24 * 60 * 60 * 1000; // 1 day in ms

if (!rawOracleUpdateTime) {
  await flagFile.appendToErrorFile(
    "No oracleUpdateTime found in oracle.json file, defaulting to 1 day but please update the file."
  );
}
oracleUpdateTime = Number(rawOracleUpdateTime) || 24 * 60 * 60 * 1000; // 1 day in ms

if (process.env.SALE_UPDATE === "true") {
  if (rawSaleUpdateTime) {
    saleUpdateTime = Number(rawSaleUpdateTime);
  }
  else {
    await flagFile.appendToErrorFile(
      "No saleUpdateTime found in oracle.json file, defaulting to 13:00 UTC but please update the file."
    );
  }

  if (Array.isArray(configAssets)) {
    assets = configAssets;
  }
}

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
async function updateAssetPrice(
  assetMarkUp,
  token,
  contractAddress,
  price,
  decimals
) {
  const parsedPriceMarkup = parseFloat(assetMarkUp) || 1;

  // Use BigNumber for precise calculation
  const priceWithMarkup = new BigNumber(price)
    .times(parsedPriceMarkup);

  // Round to 2 decimal places using decimalPlaces with ROUND_HALF_UP
  const priceBig = priceWithMarkup
    .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
    .shiftedBy(-decimals)
    .toNumber();

  const callArgs = {
    contract: {
      address: contractAddress,
    },
    method: "update",
    args: {
      _quantity: 0,
      _price: priceBig,
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
        results.filter((r) => r.status === "Pending").length === 0;
      const action = async (options) =>
        rest.getBlocResults(
          token,
          res.map((r) => r.hash),
          options
        );
      const waitResult = await util.until(
        predicate,
        action,
        { config, isAsync: true },
        3600000
      );
      for (const r of waitResult) {
        if (r.status !== "Success") {
          console.error(`Error executing distributeRewards for: ${r.hash}`, r);
          await flagFile.appendToErrorFile(
            `Error executing distributeRewards for: ${r}`
          );
        }
      }
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
    } finally {
      // Clear the call list to avoid reprocessing stale calls
      distributeRewardsCallList.length = 0;
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
      creator: "in.(BlockApps,mercata_usdst)",
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
        creator: "in.(BlockApps,mercata_usdst)",
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

// Function to fetch  and submit price
async function fetchLBMAMetalPrice(metal, apiKey) {
  try {
    const apiUrl = `https://api.metals.dev/v1/metal/authority?api_key=${apiKey}&authority=lbma&currency=USD&unit=toz`;
    const response = await axios.get(apiUrl);
    const rates = response.data.rates;
    let metalPrice;

    if (metal.toLowerCase().includes("gold")) {
      metalPrice = rates.lbma_gold_am;
    } else if (metal.toLowerCase().includes("silver")) {
      metalPrice = rates.lbma_silver;
    } else {
      throw new Error(`Metal ${metal} not supported`);
    }

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
async function fetchERC20TokenPrice(
  name,
  apiKey
) {
  try {
    const apiUrl = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;
    const currentTimeMs = Date.now();
    const OneDayHoursInMs = 24 * 60 * 60 * 1000;
    const requestBody = {
      symbol: name,
      startTime: Math.floor((currentTimeMs - OneDayHoursInMs) / 1000),
      endTime: Math.floor(currentTimeMs / 1000),
      interval: "1h",
    };
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
    return {price: twap, timestamp: currentTimestamp}
  }
  catch (error) {
    console.error("ETH TWAP calculation and submission failed:", error);
    await flagFile.appendToErrorFile(
      `ETH TWAP calculation and submission failed: ${error}`
    );
    throw error;
  }
}

// Function to fetch and submit ETH price
async function fetchAndSubmitERC20TokenPrice(
  name,
  oracleAddress,
  decimals,
  apiKey,
  token
) {
  try {
    const apiUrl = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/historical`;

    // Current time in milliseconds
    const currentTimeMs = Date.now();
    const OneDayHoursInMs = 24 * 60 * 60 * 1000;

    // Define the request body
    const requestBody = {
      symbol: name,
      startTime: Math.floor((currentTimeMs - OneDayHoursInMs) / 1000),
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
    // Round TWAP to 2 decimal places and adjust for token decimals
    const priceBig = new BigNumber(twap)
      .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
      .shiftedBy(-decimals)
      .toNumber();

    await submitPrice(
      token,
      { address: oracleAddress },
      {
        price: priceBig,
        timestamp: currentTimestamp,
      }
    );

    console.log(
      `TWAP submitted: $${twap.toFixed(2)} at ${new Date(
        currentTimeMs
      ).toISOString()}`
    );

    return {price: twap / Math.pow(10, decimals), timestamp: currentTimestamp}
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
const submitOraclePricePeriodically = async () => {
  const token = await oauthHelper.getServiceToken();

  for (const [key, oracle] of Object.entries(deployment.contracts)) {
    console.log(`[Oracle Update] Processing oracle: ${key}`);

    if (
      !oracle.name ||
      !oracle.address ||
      oracle.decimals == null ||
      !oracle.type
    ) {
      console.warn(`[Oracle WARN] Skipping invalid oracle ${key}`);
      continue;
    }

    try {
      if (oracle.type === "ERC20") {
        await fetchAndSubmitERC20TokenPrice(
          oracle.name,
          oracle.address,
          oracle.decimals,
          process.env.ALCHEMY_API_KEY,
          token
        );
      } else if (oracle.type === "Metal") {
        const metalResult = await fetchMetalPrice(
          oracle.name.toLowerCase().replace(/st$/, ""),
          process.env.METALS_API_KEY
        );
        if (metalResult) {
          // Round price to 2 decimal places and adjust for token decimals
          const priceBig = new BigNumber(metalResult.price)
            .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
            .shiftedBy(-oracle.decimals)
            .toNumber();
          await submitPrice(token, oracle, {
            price: priceBig,
            timestamp: metalResult.timestampInSeconds,
          });
          console.log(
            `[Oracle Update] Price submitted for ${
              oracle.name
            } at ${new Date().toISOString()}`
          );
        }
      } else if (oracle.type === "Constant") {
        const priceBig = new BigNumber(oracle.price)
          .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
          .shiftedBy(-oracle.decimals)
          .toNumber();
        await submitPrice(token, oracle, {
          price: priceBig,
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        console.warn(`[Oracle WARN] Skipping unsupported oracle type ${key}`);
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
  let metalResult;
  for (const asset of assets) {
    try {
      const searchOptions = {
        config,
        query: {
          address: "eq." + asset.address,
          select: "sale,name,decimals",
        },
      };

      const assetResult = await rest.search(
        token,
        { name: "BlockApps-Mercata-Asset" },
        searchOptions
      );

      if (!assetResult[0]?.sale) {
        console.warn(`[Sale Update] Skipping invalid asset ${asset.address}`);
        continue;
      }

      if (asset.type === "Metal") {
        metalResult = await fetchLBMAMetalPrice(
          asset.name.toLowerCase().replace(/st$/, ""),
          process.env.METALS_API_KEY
        );
      } else if (asset.type === "ERC20") {
        metalResult = await fetchERC20TokenPrice(
          asset.name,
          process.env.ALCHEMY_API_KEY
        );
      }

      const decimals = assetResult[0].decimals || 0;

      await updateAssetPrice(
        asset.markUp,
        token,
        assetResult[0]?.sale,
        metalResult.price,
        decimals
      );
      console.log(
        `[Sale Update] Price updated for asset: ${
          asset.address
        } at ${new Date().toISOString()}`
      );
    } catch (error) {
      console.error(
        `[Sale ERROR] Failed to update sale price for asset ${asset.address}:`,
        error
      );
      await flagFile.appendToErrorFile(
        `Failed to update sale price for asset ${asset.address}: ${error}`
      );
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
        const now = new Date();
        const currentDate = now.toISOString().split("T")[0]; // e.g., "2025-02-24"

        // Check if it's time to run the oracle update
        if (
          (now.getHours() === parseInt(oracleUpdateTime, 10) &&
            lastOracleRun !== currentDate) ||
          !lastOracleRun
        ) {
          console.log("[Oracle] Running submitOraclePricePeriodically...");
          await submitOraclePricePeriodically();
          lastOracleRun = currentDate;
        } else {
          console.log("[Oracle] Skipping since interval not reached.");
        }

        // Check if it's time to run the sale price update
        if (
          process.env.SALE_UPDATE === "true" &&
          now.getHours() === parseInt(saleUpdateTime, 10)  &&
          lastSaleRun !== currentDate
        ) {
          console.log("[Sale] Running updateSalePricePeriodically...");
          await updateSalePricePeriodically();
          lastSaleRun = currentDate;
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
