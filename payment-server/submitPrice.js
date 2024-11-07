import { assert } from "chai";
import { rest, util } from "blockapps-rest";
import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";
import axios from "axios";

/**
 * Submit price to the smart contract.
 *
 * @param {string} token - Authorization token
 * @param {object} contract - Contract to submit the price to
 * @param {object} args - Arguments for the contract method
 */
async function submitPrice(token, contract, args) {
  const callArgs = {
    contract,
    method: "submitPrice",
    args: util.usc(args),
  };
  await rest.call(token, callArgs, { config });
}

describe("Payment Server - Fetch Prices for Oracle", function () {

  before(async () => {
    assert.isDefined(
      process.env.METALS_API_KEY,
      "API key for metals API is missing. Set in .env"
    );
  });

  it("Fetches and Submits Price for Silver Oracle Every Minute", async function () {
    const { silverOracle } = deployment.contracts;

    if (!silverOracle) {
      console.warn(
        "WARN: Silver Oracle contract is not deployed. Skipping price submission."
      );
      return;
    }

    // Run the price submission every minute
    const fetchInterval = config.silverOracle.fetchInterval

    // Function to fetch the token and price, then submit to contract
    const submitPricePeriodically = async () => {
      try {
        // Refresh token each time
        const token = await oauthHelper.getServiceToken();

        // Fetch the silver price using API key from config
        const apiUrl = `https://api.metals.dev/v1/metal/spot?metal=silver&api_key=${process.env.METALS_API_KEY}&currency=USD&unit=toz`;
        const response = await axios.get(apiUrl);
        const silverPrice = response.data.rate.price;
        console.log(`Current Silver Price: $${silverPrice} per ounce`);

        await submitPrice(token, silverOracle, { price: silverPrice });
        console.log(
          `Price submitted for silver at ${new Date().toISOString()}`
        );
      } catch (error) {
        console.error("ERROR: Failed to submit price for silver:", error);
      }
    };

    // Initial submission and setting up interval
    await submitPricePeriodically(); // Immediate first run
    setInterval(submitPricePeriodically, fetchInterval);
  });
});
