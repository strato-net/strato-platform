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

// Function to fetch and submit price
async function fetchAndSubmitPrice(metal, apiKey, oracleContract, token) {
  try {
    const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=${metal}&api_key=${apiKey}&currency=USD&unit=toz`;
    const response = await axios.get(apiUrl);
    const metalPrice = response.data.rate.price;
    console.log(`Current ${metal} Price: $${metalPrice} per ounce`);

    const timestampInSeconds = Math.floor(Date.now() / 1000);
    console.log(`Current Timestamp: ${timestampInSeconds}`);

    await submitPrice(token, oracleContract, { price: metalPrice, timestamp: timestampInSeconds });
    console.log(`Price submitted for ${metal} at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`ERROR: Failed to submit price for ${metal}:`, error);
  }
}

// Main function to handle periodic fetching and submission
async function main() {
  assert.isDefined(process.env.METALS_API_KEY, "API key for metals API is missing. Set in .env");

  const { silverOracle, goldOracle } = deployment.contracts;

  if (!silverOracle && !goldOracle) {
    console.warn("WARN: No oracle contracts are deployed. Skipping price submission.");
    return;
  }

  const fetchInterval = Number(config.fetchInterval) || 60000; // Default to 1 minute

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const submitPricePeriodically = async () => {
    const token = await oauthHelper.getServiceToken();

    if (silverOracle) {
      console.log("Fetching silver price");
      await fetchAndSubmitPrice("silver", process.env.METALS_API_KEY, silverOracle, token);
    }

    if (goldOracle) {
      console.log("Fetching gold price");
      await fetchAndSubmitPrice("gold", process.env.METALS_API_KEY, goldOracle, token);
    }
  };

  while (true) {
    await submitPricePeriodically(); // Immediate first run
    console.log(`Sleeping for ${fetchInterval} ms`);
    await sleep(fetchInterval);
  }
}

main();
