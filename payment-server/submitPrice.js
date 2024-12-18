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
      console.log(`Escrow Addresses for ${reserveName} (batch ${i / batchSize + 1}): ${JSON.stringify(escrowAddresses)}`);

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

// ------------------------------------------------------------------------------------------------
// ETH PRICE FUNCTIONS
// ------------------------------------------------------------------------------------------------
// Function to fetch ETH price every 5 minutes for the last 24 hours and calculate TWAP
async function fetchAndSubmitEthPrice(oracleContract, token) {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    console.log('Fetching ETH price data from CoinGecko...');
    
    // Fetch 24h historical data from CoinGecko
    let response;
    try {
      response = await axios.get(
        'https://api.coingecko.com/api/v3/coins/ethereum/market_chart',
        {
          params: {
            vs_currency: 'usd',
            days: '2' 
            /* 2 days gets 48 entries for 1 hour intervals.
            * We need coingecko enterprise plan to get 5 minute intervals.
            * 2 day twap is slighlty more resistant to price spikes but still factors in the volatility of eth
            * If we get enterpise plan, we can use 5 minute intervals and 1 day of data to get a more accurate twap but this is good for now.
            */
          }
        }
      );
    } catch (error) {
      console.error('Failed to fetch from CoinGecko:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        error: error.message
      });
      throw new Error('CoinGecko API request failed');
    }

    // Validate response data
    if (!response.data?.prices || !Array.isArray(response.data.prices)) {
      console.error('Invalid response format:', response.data);
      throw new Error('Invalid price data format from CoinGecko');
    }

    if (response.data.prices.length === 0) {
      throw new Error('No price data returned from CoinGecko');
    }

    console.log(`Received ${response.data.prices.length} price points from CoinGecko`);

    // Convert prices to integer representation (cents) to avoid floating point issues
    const prices = response.data.prices.map(([timestamp, price]) => ({
      timestamp: Math.floor(timestamp / 1000),
      // Convert to cents and round to nearest cent
      price: Math.round(price * 100)
    }));

    // Validate price data points
    prices.forEach((point, index) => {
      if (!Number.isFinite(point.price) || point.price <= 0) {
        console.error(`Invalid price at index ${index}:`, point);
        throw new Error(`Invalid price value at index ${index}`);
      }
      if (!Number.isFinite(point.timestamp) || point.timestamp <= 0) {
        console.error(`Invalid timestamp at index ${index}:`, point);
        throw new Error(`Invalid timestamp at index ${index}`);
      }
    });

    // Calculate TWAP (working with cents)
    const twap = calculateTWAP(prices);
    // Convert back to dollars with 2 decimal places
    const twapInDollars = (twap / 100).toFixed(2);

    console.log({
      message: 'TWAP calculation completed',
      dataPoints: prices.length,
      firstTimestamp: new Date(prices[0].timestamp * 1000).toISOString(),
      lastTimestamp: new Date(prices[prices.length - 1].timestamp * 1000).toISOString(),
      calculatedTWAP: twapInDollars
    });

    // Submit TWAP price to the Oracle contract
    await submitPrice(token, oracleContract, {
      price: twapInDollars,
      timestamp: currentTimestamp,
    });

    console.log(`TWAP Price submitted: $${twapInDollars} at ${new Date(currentTimestamp * 1000).toISOString()}`);
  } catch (error) {
    console.error('ETH TWAP calculation failed:', {
      error: error.message,
      stack: error.stack
    });
    throw error; // Re-throw to be handled by the caller
  }
}

// Calculate TWAP given an array of prices and timestamps
function calculateTWAP(priceData) {
  try {
    let totalWeightedPrice = 0n; // Use BigInt for precise integer arithmetic
    let totalTime = 0n;

    for (let i = 1; i < priceData.length; i++) {
      const price = BigInt(priceData[i - 1].price);
      const deltaTime = BigInt(priceData[i].timestamp - priceData[i - 1].timestamp);

      if (deltaTime <= 0n) {
        console.warn(`Invalid time delta at index ${i}:`, {
          current: priceData[i].timestamp,
          previous: priceData[i - 1].timestamp
        });
        continue;
      }

      totalWeightedPrice += price * deltaTime;
      totalTime += deltaTime;
    }

    if (totalTime <= 0n) {
      throw new Error('Invalid total time in TWAP calculation');
    }

    // Convert back to number for final calculation
    return Number(totalWeightedPrice) / Number(totalTime);
  } catch (error) {
    console.error('TWAP calculation error:', {
      error: error.message,
      dataPoints: priceData.length
    });
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------

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
      if (!oracle.metal || !oracle.address) {
        console.warn(`WARN: Skipping invalid oracle ${key}`);
        continue;
      }

      try {
        const metal = oracle.metal.toLowerCase();
        console.log(`Fetching price for ${metal}`);
  
        if (metal === 'eth') {
          await fetchAndSubmitEthPrice(oracle, token);
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
