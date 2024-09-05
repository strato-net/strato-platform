import { util, rest } from "/blockapps-rest-plus";
import RestStatus from "http-status-codes";
import { setSearchQueryOptions, searchAll } from "/helpers/utils";
import dayjs from "dayjs";

import inventoryJs from "/dapp/products/inventory";
import saleJs from "/dapp/orders/sale";
import saleOrderJs from "/dapp/orders/saleOrder";
import constants from "/helpers/constants";
import strats from "/dapp/strats/strats";

function marshalOut(_args) {
  const args = {
    ..._args,
  };
  return args;
}

async function getWalletSummary(admin, args = {}, options) {
  const { userAddress } = args;
  const getOptions = { ...options, org: "TestCompany", app: "" };
  const stratsAddress = strats.getStratsAddress();

  const stratsBalanceArgs = {
    address: stratsAddress,
    key: userAddress,
  };

  const stratsBalance = await strats.getStratsBalance(
    admin,
    stratsBalanceArgs,
    getOptions
  );

  // add more summary information here if needed

  return { stratsBalance };
}

function calculateGainLossPercentage(
  currentPrice,
  originalPrice,
  highestMarketplacePrice,
  lastSoldPrice
) {
  let basePrice;
  if (originalPrice !== null && originalPrice !== 0) {
    basePrice = originalPrice;
  } else if (lastSoldPrice !== null && lastSoldPrice !== 0) {
    basePrice = lastSoldPrice;
  } else if (
    highestMarketplacePrice !== null &&
    highestMarketplacePrice !== 0
  ) {
    basePrice = highestMarketplacePrice;
  } else {
    return null; // Avoid invalid calculation
  }

  if (basePrice === 0) {
    return null; // Avoid division by zero
  }

  const percentageChange = ((currentPrice - basePrice) / basePrice) * 100;
  return percentageChange.toFixed(2); // Return percentage with 2 decimal places
}

async function getHighestMarketplacePrice(admin, originAddress, options) {
  try {
    const marketplaceListings = await inventoryJs.getAll(
      admin,
      {
        originAddress: originAddress,
        isMarketplaceSearch: true,
        isTrendingSearch: false,
        limit: 15
      },
      options
    );

    if (marketplaceListings.length === 0) {
      return null;
    }

    const highestPrice = Math.max(
      ...marketplaceListings.map((listing) => listing.price || 0)
    );
    return highestPrice > 0 ? highestPrice : null;
  } catch (error) {
    console.error(
      `Error fetching marketplace listings for origin address ${originAddress}:`,
      error
    );
    return null;
  }
}

async function getLastSoldPrice(admin, assetAddress, options) {
  try {
    const lastSale = await saleJs.getAll(
      admin,
      {
        assetToBeSold: [assetAddress],
        order: "block_timestamp.desc",
        limit: 1,
      },
      options
    );

    return lastSale.length > 0 ? lastSale[0].price : null;
  } catch (error) {
    console.error(
      `Error fetching last sold price for asset ${assetAddress}:`,
      error
    );
    return null;
  }
}

async function getWalletAssets(admin, args = {}, options) {
  const inventoryResults = await inventoryJs.getAll(
    admin,
    { ...args },
    options
  );
  const inventoryCount = await inventoryJs.inventoryCount(
    admin,
    { ...args },
    options
  );

  const processedResults = await Promise.all(
    inventoryResults.map(async (inventory) => {
      console.log(`Processing inventory item: ${inventory.address}`);

      try {
        const originAddress = inventory.originAddress;

        // Get the highest marketplace price for items with the same origin address
        const highestMarketplacePrice = await getHighestMarketplacePrice(
          admin,
          originAddress,
          options
        );

        // Get the last sold price for this specific asset
        const lastSoldPrice = await getLastSoldPrice(
          admin,
          originAddress,
          options
        );

        // Determine the final price (highest of inventory price, marketplace price, and last sold price)
        const finalPrice = Math.max(
          inventory.price || 0,
          highestMarketplacePrice || 0,
          lastSoldPrice || 0
        );

        // Calculate gain/loss percentage
        const gainLossPercentage = calculateGainLossPercentage(
          finalPrice,
          inventory.price,
          highestMarketplacePrice,
          lastSoldPrice
        );

        console.log(`
          For inventory ${inventory.address}:
          Original price: ${inventory.price}
          Highest marketplace price: ${highestMarketplacePrice}
          Last sold price: ${lastSoldPrice}
          Final price: ${finalPrice}
          Gain/Loss percentage: ${gainLossPercentage}
        `);

        return {
          ...inventory,
          price: finalPrice, // Update the price field with the final calculated price
          originalPrice: inventory.price, // Keep the original price for reference
          lastSoldPrice,
          highestMarketplacePrice,
          gainLossPercentage,
        };
      } catch (error) {
        console.error(
          `Error processing inventory ${inventory.address}:`,
          error
        );
        return inventory;
      }
    })
  );

  const result = {
    inventoryResults: processedResults.map((inventory) =>
      marshalOut(inventory)
    ),
    inventoryCount: inventoryCount,
  };

  // Print the first item of the results
  console.log("Wallet Assets:");
  console.log("Inventory Count:", result.inventoryCount);
  if (result.inventoryResults.length > 0) {
    console.log("First Inventory Item:");
    console.log(JSON.stringify(result.inventoryResults[0], null, 2));
  } else {
    console.log("No inventory items found.");
  }

  return result;
}

export default {
  getWalletSummary,
  getWalletAssets,
  marshalOut,
};
