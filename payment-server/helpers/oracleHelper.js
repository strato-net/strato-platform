import { rest, util } from "blockapps-rest";
import axios from "axios";
import BigNumber from "bignumber.js";

// Function to submit price to the oracle contract
async function submitPrice(token, contract, args, config) {
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
  decimals,
  config
) {
  const parsedPriceMarkup = parseFloat(assetMarkUp) || 1;

  // Use BigNumber for precise calculation
  const priceWithMarkup = new BigNumber(price).times(parsedPriceMarkup);

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

// Function to submit price to the oracle contract
async function fetchAsset(token, args, config) {
  const searchOptions = {
    config,
    query: {
      root: "eq." + args.address,
      select: "count",
      offset: 0,
      limit: undefined,
    },
  };

  // Get the total count of assets.
  const countResponse = await rest.search(
    token,
    { name: "BlockApps-Mercata-Asset" },
    searchOptions
  );
  const totalCount = countResponse?.[0]?.count || 0;
  if (totalCount <= 0) {
    return [];
  }

  // Map to hold the best sale UTXO per asset root.
  const bestSalesByRoot = new Map();
  const batchSize = 100;

  // Process UTXOs in batches.
  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const batchOptions = {
      config,
      query: {
        select:
          "*,BlockApps-Mercata-Sale!BlockApps-Mercata-Sale_BlockApps-Mercata-Asset_fk(*,BlockApps-Mercata-Sale-paymentServices(*))",
        root: "eq." + args.address,
        offset,
        limit: batchSize,
      },
    };

    const batchUtxos = await rest.search(
      token,
      { name: "BlockApps-Mercata-Asset" },
      batchOptions
    );

    batchUtxos.forEach((utxo) => {
      // Retrieve sale data and look for an open sale.
      const sales = utxo["BlockApps-Mercata-Sale"] || [];
      const openSale = sales.find((sale) => sale.isOpen === true);

      // Validate UTXO based on sale state.
      if (openSale) {
        if (utxo.ownerCommonName !== utxo.data?.minterCommonName) return;
      } else {
        if (utxo.address !== utxo.root) return;
      }

      // Check and update the best sale for this root.
      const currentBest = bestSalesByRoot.get(utxo.root);
      if (!currentBest) {
        bestSalesByRoot.set(
          utxo.root,
          openSale
            ? { ...utxo, 'BlockApps-Mercata-Sale': [openSale] }
            : { ...utxo, sale: null, "BlockApps-Mercata-Sale": [] }
        );
      } else if (openSale) {
        const currentSale = currentBest["BlockApps-Mercata-Sale"]?.find(
          (s) => s.isOpen
        );
        if ((currentSale?.quantity || 0) < (openSale.quantity || 0)) {
          bestSalesByRoot.set(utxo.root, utxo);
        }
      }
    });
  }

  return Array.from(bestSalesByRoot.values());
}

// Function to fetch the price of a metal
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
    throw error;
  }
}

// Function to fetch the LBMA AM price of a metal
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
    throw error;
  }
}

// Function to fetch and submit ETH price
async function fetchERC20TokenPrice(name, apiKey) {
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
    return { price: twap, timestamp: currentTimestamp };
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
export {
  submitPrice,
  updateAssetPrice,
  fetchMetalPrice,
  fetchLBMAMetalPrice,
  fetchERC20TokenPrice,
  fetchAsset,
};
