import { util, rest } from "/blockapps-rest-plus";
import RestStatus from "http-status-codes";
import { setSearchQueryOptions, searchAll } from "/helpers/utils";
import dayjs from "dayjs";

import inventoryJs from "/dapp/products/inventory";
import saleJs from "/dapp/orders/sale";
import saleOrderJs from "/dapp/orders/saleOrder";
import constants from "/helpers/constants";
import strats from "/dapp/strats/strats";
import { searchAllWithQueryArgs } from '/helpers/utils';

const contractName = constants.assetTableName;

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

function calculateGainLossPercentage(currentPrice, lastSoldPrice, transferPrice) {
  let basePrice = lastSoldPrice;
  
  // If lastSoldPrice is not available, use transferPrice
  if (lastSoldPrice === null || lastSoldPrice === 0 || lastSoldPrice === currentPrice) {
    basePrice = transferPrice;
  }

  if (basePrice === null || basePrice === 0 || currentPrice === null || currentPrice === 0) {
    return 0; // Return 0 if either price is invalid
  }

  const percentageChange = ((currentPrice - basePrice) / basePrice) * 100;
  return isNaN(percentageChange) ? 0 : parseFloat(percentageChange.toFixed(2)); // Ensure we return a number, not a string
}

async function getHighestMarketplacePrice(admin, originAddress, options) {
  try {
    const marketplaceListings = await inventoryJs.getAll(
      admin,
      {
        originAddress: originAddress,
        isMarketplaceSearch: true,
        isTrendingSearch: false,
        limit: 15,
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
    const saleHistory = await saleJs.getAllSaleHistory(
      admin,
      {
        assetToBeSold: assetAddress,
        order: "block_timestamp.desc",
        limit: 6,
      },
      options
    );

    if (saleHistory && saleHistory.length > 0) {
      return saleHistory[0].price;
    } else {
      return null;
    }
  } catch (error) {
    console.error(
      `Error fetching last sold price for asset ${assetAddress}:`,
      error
    );
    return null;
  }
}

async function getOwnershipHistory(user, args, options) {
  const { originAddress, minItemNumber, maxItemNumber } = args;
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' }
  const searchArgs = {
      originAddress,
      gteField: 'maxItemNumber',
      gteValue: minItemNumber,
      lteField: 'minItemNumber',
      lteValue: maxItemNumber,
      sort: '+block_timestamp'
  };

  const history = await searchAllWithQueryArgs(`${contractName}.OwnershipTransfer`, searchArgs, newOptions, user);
  return history;
}

async function getAllItemTransferEvents(admin, newOwner, assetName, options) {
  try {
    const contractName = "Mercata";
    const defaultOptions = {
      ...options,
      chainIds: [],
      cacheNonce: true,
    };

    const contract = {
      getAllItemTransferEvents: function (args, options = defaultOptions) {
        const getOptions = { ...options, app: contractName };
        return inventoryJs.getAllItemTransferEvents(admin, args, getOptions);
      }
    };

    const transferEventsArgs = {
      newOwner: newOwner,
      assetName: assetName,
    };

    const transferEvents = await contract.getAllItemTransferEvents(transferEventsArgs, defaultOptions);
    return transferEvents;
  } catch (error) {
    console.error("Error fetching item transfer events:", error);
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
      try {
        const originAddress = inventory.originAddress;

        // Get ownership history and log it
        // const ownershipHistory = await getOwnershipHistory(admin, { originAddress, minItemNumber: 1, maxItemNumber: 10 }, options);
        // const isRelevantToAdmin = ownershipHistory.every(entry => entry.purchaserCommonName === admin.username);

        // Get the highest marketplace price for items with the same origin address
        const highestMarketplacePrice = await getHighestMarketplacePrice(
          admin,
          originAddress,
          options
        );

        // Get the last sold price for this specific asset
        let lastSoldPrice = 0;
          lastSoldPrice = await getLastSoldPrice(
            admin,
            originAddress,
            options
          );

         // Get item transfer events
         const transferEvents = await getAllItemTransferEvents(admin, admin.address, inventory.name, options);
         const matchingTransfer = transferEvents && transferEvents.transfers 
           ? transferEvents.transfers.find(transfer => transfer.block_hash === inventory["BlockApps-Mercata-Asset-images"][0].block_hash)
           : null;
         const transferPrice = matchingTransfer ? matchingTransfer.price || 0 : 0;
        
        
        // Determine the final price based on the new logic
        let finalPrice;
        if (highestMarketplacePrice !== null && highestMarketplacePrice !== undefined && highestMarketplacePrice !== 0) {
          finalPrice = highestMarketplacePrice;
        } else if (inventory.price !== null && inventory.price !== undefined && inventory.price !== 0) {
          finalPrice = inventory.price;
        } else if (lastSoldPrice !== 0 && lastSoldPrice !== undefined && lastSoldPrice !== null) {
          finalPrice = lastSoldPrice;
        } else if (transferPrice !== null && transferPrice !== undefined && transferPrice !== 0) {
          finalPrice = transferPrice;
        } else {
          finalPrice = 0;
        }

        // Calculate gain/loss percentage using the simplified logic
        const gainLossPercentage = calculateGainLossPercentage(finalPrice, lastSoldPrice, transferPrice);

        return {
          ...inventory,
          price: finalPrice, // Update the price field with the final calculated price
          originalPrice: inventory.price, // Keep the original price for reference
          lastSoldPrice,
          highestMarketplacePrice,
          transferPrice,
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

  return result;
}

export default {
  getWalletSummary,
  getWalletAssets,
  marshalOut,
};
