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
    user,
    { name: "BlockApps-Mercata-Reserve" },
    reserveSearchOptions
  );

  if (!reserves || reserves.length === 0) {
    throw new Error("No reserves found");
  }

  for (const reserve of reserves) {
    const reserveName = reserve.name;
    const reserveAddress = reserve.address;

    // Define search options for active escrows
    const searchOptions = {
      config,
      query: {
        creator: "eq.BlockApps",
        isOpen: "eq.true",
        "data->>reserve": "eq." + reserveAddress,
      },
    };

    // Fetch escrows from Cirrus
    const escrows = await rest.search(
      user,
      { name: "BlockApps-Mercata-Sale" },
      searchOptions
    );

    if (!escrows || escrows.length === 0) {
      console.log(`No escrows found for reserve ${reserveName}`);
      continue;
    }

    // Extract escrow addresses
    const escrowAddresses = escrows.map((escrow) => escrow.address);
    console.log(`Escrow Addresses for ${reserveName}: ${JSON.stringify(escrowAddresses)}`);

    await distributeRewards(
      token,
      { address: reserveAddress, name: reserveName },
      { escrowAddresses }
    );
    console.log(
      `Escrow Addresses submitted for ${reserveName} at ${new Date().toISOString()}`
    );
  }
}

// Function to fetch and submit price
async function fetchAndSubmitPrice(metal, apiKey, oracleContract, token) {
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

// Main function to handle periodic fetching and submission
async function main() {
  assert.isDefined(
    process.env.METALS_API_KEY,
    "API key for metals API is missing. Set in .env"
  );

  const { contracts } = deployment;

  const fetchInterval = Number(config.fetchInterval) || 60000; // Default to 1 minute

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const submitPricePeriodically = async () => {
    const token = await oauthHelper.getServiceToken();

    for (const [key, oracle] of Object.entries(contracts)) {
      console.log(`Processing oracle: ${key}`);

      // Ensure the oracle contract has the necessary structure
      if (!oracle.name || !oracle.address) {
        console.warn(`WARN: Skipping invalid oracle ${key}`);
        continue;
      }

      const metal = oracle.name.toLowerCase(); // Assumes oracle name matches metal type (e.g., "silverOracle" -> "silver")
      console.log(`Fetching price for ${metal}`);

      await fetchAndSubmitPrice(
        metal,
        process.env.METALS_API_KEY,
        oracle,
        token
      );
      await fetchAndSubmitEscrowAddresses(oracle, token);
    }
  };

  while (true) {
    await submitPricePeriodically(); // Immediate first run
    console.log(`Sleeping for ${fetchInterval} ms`);
    await sleep(fetchInterval);
  }
}

main();
