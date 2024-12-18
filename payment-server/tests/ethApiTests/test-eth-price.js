//Use for testing the twap calculation using coingecko api
// Just run node test-eth-price.js in this directory to get the results

import axios from 'axios';

// Function to fetch ETH price every 5 minutes for the last 24 hours and calculate TWAP
async function fetchAndSubmitEthPrice() {
  try {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    console.log('Fetching ETH price data from CoinGecko...');
    
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

    // Validate and log raw response
    console.log('Raw price data sample:', response.data.prices.slice(0, 3));

    if (!response.data?.prices || !Array.isArray(response.data.prices)) {
      console.error('Invalid response format:', response.data);
      throw new Error('Invalid price data format from CoinGecko');
    }

    if (response.data.prices.length === 0) {
      throw new Error('No price data returned from CoinGecko');
    }

    console.log(`Received ${response.data.prices.length} price points from CoinGecko`);

    const prices = response.data.prices.map(([timestamp, price]) => ({
      timestamp: Math.floor(timestamp / 1000),
      price: Math.round(price * 100)
    }));

    // Log sample of processed prices
    console.log('Processed price sample:', prices.slice(0, 3));

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

    const twap = calculateTWAP(prices);
    const twapInDollars = (twap / 100).toFixed(2);

    console.log({
      message: 'TWAP calculation completed',
      dataPoints: prices.length,
      firstTimestamp: new Date(prices[0].timestamp * 1000).toISOString(),
      lastTimestamp: new Date(prices[prices.length - 1].timestamp * 1000).toISOString(),
      calculatedTWAP: twapInDollars
    });

  } catch (error) {
    console.error('ETH TWAP calculation failed:', {
      error: error.message,
      stack: error.stack
    });
  }
}

function calculateTWAP(priceData) {
  try {
    let totalWeightedPrice = 0n;
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

    return Number(totalWeightedPrice) / Number(totalTime);
  } catch (error) {
    console.error('TWAP calculation error:', {
      error: error.message,
      dataPoints: priceData.length
    });
    throw error;
  }
}

// Run the test
fetchAndSubmitEthPrice(); 