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

// Main function to handle price fetching and submission
async function main() {
  assert.isDefined(
    process.env.METALS_API_KEY,
    "API key for metals API is missing. Set in .env"
  );

  const { silverOracle } = deployment.contracts;

  if (!silverOracle) {
    console.warn(
      "WARN: Silver Oracle contract is not deployed. Skipping price submission."
    );
    return;
  }

  const fetchInterval = Number(config.silverOracle.fetchInterval) || 6000000; // Default to 1 minute

  const submitPricePeriodically = async () => {
    try {
      const token = await oauthHelper.getServiceToken();
      const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=silver&api_key=${process.env.METALS_API_KEY}&currency=USD&unit=toz`;
      const response = await axios.get(apiUrl);
      const silverPrice = response.data.rate.price;
      console.log(`Current Silver Price: $${silverPrice} per ounce`);

      await submitPrice(token, silverOracle, { price: silverPrice });
      console.log(`Price submitted for silver at ${new Date().toISOString()}`);
    } catch (error) {
      console.error("ERROR: Failed to submit price for silver:", error);
    }
  };

  await submitPricePeriodically(); // Immediate first run
  setInterval(submitPricePeriodically, fetchInterval);
}

main();
