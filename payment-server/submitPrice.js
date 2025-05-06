import fs from "fs";
import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import http from "http";
import BigNumber from "bignumber.js";

import {
  submitPrice,
  updateAssetPrice,
  fetchLBMAMetalPrice,
  fetchCurrentERC20TokenPrice,
  fetchERC20TokenPrice,
  fetchMetalPrice,
  fetchAsset,
} from "./helpers/oracleHelper.js";
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
const { oracleUpdateTime: rawOracleUpdateTime, assets: configAssets = [] } =
  oracleConfig;

// Set defaults
let assets = [];
let oracleUpdateTime = 24 * 60 * 60 * 1000; // 1 day in ms

if (!rawOracleUpdateTime) {
  await flagFile.appendToErrorFile(
    "No oracleUpdateTime found in oracle.json file, defaulting to 1 day but please update the file."
  );
}
oracleUpdateTime = Number(rawOracleUpdateTime) || 24 * 60 * 60 * 1000; // 1 day in ms

if (process.env.SALE_UPDATE === "true") {
  if (Array.isArray(configAssets)) {
    assets = configAssets;
  } else {
    await flagFile.appendToErrorFile(
      "Invalid assets format in oracle.json file, should be an array."
    );
  }
}

// Global array to store all distributeRewards calls
const distributeRewardsCallList = [];

// Global map to track the last update hour for each asset.
// The key is a unique identifier (for example, asset address)
// and the value is the "hour stamp" (number of hours since the epoch) when it was last updated.
const lastSaleUpdateMap = {};

// Instead of calling rest.call directly, accumulate call arguments for distributeRewards
async function distributeRewards(contract, args) {
  const callArgs = {
    contract,
    method: "distributeRewards",
    args: util.usc(args),
  };
  // Push call arguments into the global array
  distributeRewardsCallList.push(callArgs);
}

// After all calls are collected, we run them at once
async function runDistributeRewardsCalls() {
  if (distributeRewardsCallList.length > 0) {
    console.log("Executing batch callList for distributeRewards...");
    let res;
    try {
      res = await rest.callList(await oauthHelper.getServiceToken(), distributeRewardsCallList, {
        config,
        cacheNonce: true,
        isAsync: true,
      });
      // wait until there are no more PENDING results
      const predicate = (results) =>
        results.filter((r) => r.status === "Pending").length === 0;
      const action = async (options) =>
        rest.getBlocResults(
          await oauthHelper.getServiceToken(),
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
            `Error executing distributeRewards for hash: ${r.hash}, r.status=${r.status}. See oracle container logs for more details.`
          );
        }
      }
      console.log("Batch distributeRewards calls completed.");
    } catch (error) {
      console.error("Error executing batch distributeRewards calls:", error);
      console.error(
        "The hashes of distribute rewards transactions in a failed batch:",
        res.map((r) => r.hash)
      );
      await flagFile.appendToErrorFile(
        `Error executing batch distributeRewards calls: ${error.message}. See oracle container logs for more details and the failed transaction hashes.`
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
async function fetchAndSubmitEscrowAddresses(oracleContract) {
  const reserveSearchOptions = {
    config,
    query: {
      creator: "in.(BlockApps,mercata_usdst)",
      isActive: "eq.true",
      oracle: "eq." + oracleContract.address,
    },
  };

  const reserves = await rest.search(
    await oauthHelper.getServiceToken(),
    { name: "BlockApps-Mercata-Reserve" },
    reserveSearchOptions
  );

  if (!reserves || reserves.length === 0) {
    console.log("No reserves found for:", oracleContract.name);
    return;
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
      await oauthHelper.getServiceToken(),
      { name: "BlockApps-Mercata-Escrow" },
      searchOptions
    );

    if (!escrows || escrows.length === 0) {
      console.log(`No escrows found for reserve ${reserveName}`);
      // Collect callArgs for empty escrowAddresses to distributeRewards
      await distributeRewards(
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
        { address: reserveAddress, name: reserveName },
        { escrowAddresses }
      );
    }

    console.log(
      `Escrow Addresses submitted for ${reserveName} at ${new Date().toISOString()}`
    );
  }
}

// Function to submit oracle prices periodically
const submitOraclePricePeriodically = async () => {
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
    let result = null;
    try {
      if (oracle.type === "ERC20") {
        result = await fetchERC20TokenPrice(
          oracle.name,
          process.env.ALCHEMY_API_KEY
        );
      } else if (oracle.type === "Metal") {
        result = await fetchMetalPrice(
          oracle.name.toLowerCase().replace(/st$/, ""),
          process.env.METALS_API_KEY
        );
      } else if (oracle.type !== "Constant") {
        console.warn(`[Oracle WARN] Skipping unsupported oracle type ${key}`);
        continue;
      }
      const priceBig = new BigNumber(result ? result.price : oracle.price)
        .decimalPlaces(2, BigNumber.ROUND_HALF_UP)
        .shiftedBy(-oracle.decimals)
        .toNumber();
      console.log(
        `[Oracle Update] Price submitted for ${
          oracle.name
        } at ${new Date().toISOString()}`
      );
      await submitPrice(
        await oauthHelper.getServiceToken(),
        oracle,
        {
          price: priceBig,
          timestamp: Math.floor(Date.now() / 1000),
        },
        config
      );
      await fetchAndSubmitEscrowAddresses(oracle);
    } catch (error) {
      console.error(`[Oracle ERROR] Failed to process oracle ${key}:`, error);
      await flagFile.appendToErrorFile(
        `Failed to process oracle ${key}: ${error.message}`
      );
    }
  }
  await runDistributeRewardsCalls();
};

// Function to update sale prices periodically
const updateSalePricePeriodically = async () => {
  const getMetalAccessToken = async () => 
      await oauthHelper.getUserToken(
          process.env.METALS_USERNAME,
          process.env.METALS_PASSWORD
      );
  const getErc20AccessToken = async () => 
      await oauthHelper.getUserToken(
          process.env.TOKENS_USERNAME,
          process.env.TOKENS_PASSWORD
      );

  // Get the current UTC hour and current hour stamp.
  const now = new Date();
  const currentHour = now.getUTCHours(); // e.g., 13, 19, etc.
  const currentHourStamp = Math.floor(Date.now() / (60 * 60 * 1000)); // number of hours since epoch

  let result;
  for (const asset of assets) {
    // Check if the hour is in the asset's hours array and if the last update hour is the same as the current hour.
    if (
      !asset.hours.includes(currentHour) ||
      lastSaleUpdateMap[asset.address] === currentHourStamp
    ) {
      continue;
    }
    console.log("[Sale] Running updateSalePricePeriodically");
    try {
      // Fetch the asset (with sale details) from the blockchain.
      const assetResult = await fetchAsset(
        await getMetalAccessToken(),
        { address: asset.address },
        config
      );

      if (!assetResult || assetResult.length === 0) {
        console.warn(`[Sale Update] No asset found for ${asset.address}`);
        continue;
      }
      if (!assetResult[0]?.sale) {
        console.warn(`[Sale Update] Skipping invalid asset ${asset.address}`);
        continue;
      }

      // Fetch the latest price based on asset type.
      if (asset.type === "Metal") {
        result = await fetchLBMAMetalPrice(
          asset.name.toLowerCase().replace(/st$/, ""),
          process.env.METALS_API_KEY
        );
      } else if (asset.type === "ERC20") {
        result = await fetchCurrentERC20TokenPrice(
          asset.name,
          process.env.ALCHEMY_API_KEY
        );
      }

      const decimals = assetResult[0].decimals
        ? assetResult[0].decimals
        : assetResult[0].name.toLowerCase().includes("eth")
        ? 18
        : 0;

      // Update the asset's price with the new data.
      await updateAssetPrice(
        asset.markUp,
        asset.type === "ERC20" ? await getErc20AccessToken() : await getMetalAccessToken(),
        assetResult[0]?.sale,
        result.price,
        decimals,
        config
      );
      console.log(
        `[Sale Update] Price updated for asset: ${
          asset.address
        } at ${new Date().toISOString()}`
      );

      // Record that this asset has been updated for the current hour.
      lastSaleUpdateMap[asset.address] = currentHourStamp;
    } catch (error) {
      console.error(
        `[Sale ERROR] Failed to update sale price for asset ${asset.address}:`,
        error
      );
      await flagFile.appendToErrorFile(
        `Failed to update sale price for asset ${asset.address}: ${error.message}`
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
  let lastLoopTimestamp = 0; // Initialize with 0

  const heartbeatServer = http.createServer(async (_, res) => {
    const errorFlagRaised = await flagFile.isErrorFlagRaised();
    const currentTime = Date.now();
    const timeSinceLastLoop = currentTime - lastLoopTimestamp;
    const isHealthy = timeSinceLastLoop < 15 * 60 * 1000; // Check if the last loop was started within 15 minutes
    
    if (!errorFlagRaised) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        success: true, 
        message: "pong",
        lastLoopTimestamp: new Date(lastLoopTimestamp).toISOString(),
        health: isHealthy
      }));
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          message: "server error, check errors",
          lastLoopTimestamp: new Date(lastLoopTimestamp).toISOString(),
          health: isHealthy
        })
      );
    }
  });
  const port = process.env.PORT || 8018;
  heartbeatServer.listen(port, () => {
    console.log(`Heartbeat server started on port ${port}.`);
  });

  // Custom TimeoutError class
  class TimeoutError extends Error {
    constructor(message) {
      super(message);
      this.name = 'TimeoutError';
    }
  }

  function createTimeoutPromise(seconds, breachMessage) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(breachMessage));
      }, seconds * 1000);
    });
  }

  // Periodically fetch prices and update
  const runTasks = async () => {
    while (true) {
      try {
        lastLoopTimestamp = Date.now(); // Update the timestamp at the start of each loop
        
        const now = new Date();
        const currentDate = now.toISOString().split("T")[0]; // e.g., "2025-02-24"

        // Check if it's time to run the oracle update
        if (
          (now.getHours() > parseInt(oracleUpdateTime, 10) &&
            lastOracleRun !== currentDate) ||
          !lastOracleRun
        ) {
          console.log("[Oracle] Running submitOraclePricePeriodically...");
          try {
            await Promise.race([
              submitOraclePricePeriodically(),
              createTimeoutPromise(4200, "submitOraclePricePeriodically timed out after 4200 seconds")
            ]);
            lastOracleRun = currentDate;
          } catch (error) {
            if (error instanceof TimeoutError) {
              console.error("[Oracle] submitOraclePricePeriodically did not respond within the timeout period:", error.message);
              await flagFile.appendToErrorFile(`submitOraclePricePeriodically did not respond within the timeout period: ${error.message}`);
              lastOracleRun = currentDate; // still setting that Oracle ran on the currentDate to keep the behavior it had before the timeout implementation
            } else {
              console.error("[Oracle] Unhandled error in submitOraclePricePeriodically:", error);
              await flagFile.appendToErrorFile(`Unhandled error in submitOraclePricePeriodically: ${error.message}`);
            }
          }
        } else {
          console.log("[Oracle] Skipping 'submitOraclePricePeriodically' since interval not reached.");
        }

        // Check if it's time to run the sale price update
        if (process.env.SALE_UPDATE === "true") {
          console.log("[Sale] Running updateSalePricePeriodically...");
          try {
            await Promise.race([
              updateSalePricePeriodically(),
              createTimeoutPromise(3600, "updateSalePricePeriodically timed out after 3600 seconds")
            ]);
          } catch (error) {
            if (error instanceof TimeoutError) {
              console.error("[Sale] updateSalePricePeriodically did not respond within the timeout period:", error.message);
              await flagFile.appendToErrorFile(`updateSalePricePeriodically did not respond within the timeout period: ${error.message}`);
            } else {
              console.error("[Sale] Unhandled error in updateSalePricePeriodically:", error);
              await flagFile.appendToErrorFile(`Unhandled error in updateSalePricePeriodically: ${error.message}`);
            }
          }
        } else {
          console.log("[Sale] Skipping 'updateSalePricePeriodically' since SALE_UPDATE is not set to true.");
        }
      } catch (error) {
        console.error("Error in main loop:", error);
        await flagFile.appendToErrorFile(`Error in main loop: ${error.message}`);
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
