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

function calculateGainLossPercentage(currentPrice, lastSoldPrice) {
  if (lastSoldPrice === null || lastSoldPrice === 0) {
    return null; // Avoid division by zero or invalid calculation
  }
  const percentageChange =
    ((currentPrice - lastSoldPrice) / lastSoldPrice) * 100;
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
  const { address, ...otherArgs } = args;

  const queryArgs = address ? { ...otherArgs, owner: address } : otherArgs;

  const inventoryResults = await inventoryJs.getAll(
    admin,
    { ...queryArgs, isMarketplaceSearch: true, isTrendingSearch: false },
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
        const assetWithoutQuantity = await inventoryJs.get(
          admin,
          { address: inventory.address },
          options
        );
        const originAddress = assetWithoutQuantity.originAddress;

        // Get the highest marketplace price for items with the same origin address
        const highestMarketplacePrice = await getHighestMarketplacePrice(
          admin,
          originAddress,
          options
        );

        // Get the last sold price for this specific asset
        const lastSoldPrice = await getLastSoldPrice(
          admin,
          inventory.address,
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
