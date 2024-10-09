import { rest } from 'blockapps-rest'
import constants from '../../../helpers/constants'
import STRATSJs from '../../../dapp/items/STRATS'


class MarketplaceController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { soldOut, forSale, ...restQuery } = query;
      const limit = parseInt(req.headers["limit"]) || 10;
      const offset = (parseInt(req.headers["offset"]) - 1 || 0) * limit;

      const inventories = await dapp.getMarketplaceInventories({
        ...restQuery,
      });
      let finalInventory = MarketplaceController.getFinalInventory(
        inventories,
        forSale,
        soldOut
      );
      const paginatedInventory = finalInventory.slice(offset, offset + limit);

      rest.response.status200(res, {
        productsWithImageUrl: paginatedInventory,
        inventoryCount: finalInventory.length,
      });
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req;
      const { soldOut, forSale, ...restQuery } = query;
      const limit = parseInt(req.headers["limit"]) || 10;
      const offset = (parseInt(req.headers["offset"]) - 1 || 0) * limit;
      const inventories = await dapp.getMarketplaceInventoriesLoggedIn({
        ...restQuery,
      });
      let finalInventory = MarketplaceController.getFinalInventory(
        inventories,
        forSale,
        soldOut
      );

      const paginatedInventory = finalInventory.slice(offset, offset + limit);

      rest.response.status200(res, {
        productsWithImageUrl: paginatedInventory,
        inventoryCount: finalInventory.length,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getTopSellingProducts(req, res, next) {
    try {
      const { dapp, query } = req;
      const inventories = await dapp.getTopSellingProducts({ ...query });
      const productsWithImageUrl = inventories.sort((a, b) => {
        return b.saleDate.localeCompare(a.saleDate);
      });

      rest.response.status200(res, productsWithImageUrl);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getTopSellingProductsLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req;
      const inventories = await dapp.getTopSellingProductsLoggedIn({
        ...query,
      });
      const productsWithImageUrl = inventories.sort((a, b) => {
        return b.saleDate.localeCompare(a.saleDate);
      });

      rest.response.status200(res, productsWithImageUrl);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getStratsBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      let stratsBalance = 0;

      stratsBalance = await dapp.getStratsBalance({ userAddress: userAddress });

      return rest.response.status200(res, stratsBalance);
    } catch (e) {
      return next(e);
    }
  }
  
  static async getStratsAddress(req, res, next) {
    try {
      
      const address = await STRATSJs.getStratsAddress();

      return rest.response.status200(res, address)
    } catch (e) {
      return next(e)
    }
  }

  static async getStratsTransactionHistory(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;

      const stratsTransactionHistory = await dapp.getStratsTransactionHistory({
        userAddress: userAddress,
      });

      return rest.response.status200(res, stratsTransactionHistory);
    } catch (e) {
      return next(e);
    }
  }

  static async transferStrats(req, res, next) {
    try {
      const { dapp, body } = req;
      const { to, value } = body;

      await dapp.transferStrats({ to, value });

      return rest.response.status200(res);
    } catch (e) {
      return next(e);
    }
  }

  static getFinalInventory(inventories, forSale, soldOut) {
    let unlisted = [];
    let listed = inventories?.inventoryResults?.filter((item, index) => {
      //for ba sellers, get all assets - display For Sale and Sold Out
      if (constants.baUserNames.includes(item.ownerCommonName)) {
        //
        if (item.saleQuantity && item.saleQuantity !== 0) {
          return item;
        } else {
          unlisted.push(item);
        }
      } else {
        // for non-ba sellers, get assets with valid sale & saleQty > 0 - display only For Sale records
        if (item.saleQuantity && item.saleQuantity !== 0) {
          return item;
        }
      }
    });

    listed = listed.sort((a, b) => {
      return b?.saleDate?.localeCompare(a?.saleDate);
    });

    let finalInventory;
    if (forSale === "true" && soldOut === "true") {
      finalInventory = [...listed, ...unlisted];
    } else if (forSale === "true" && soldOut === "false") {
      finalInventory = [...listed];
    } else if (forSale === "false" && soldOut === "true") {
      finalInventory = [...unlisted];
    } else {
      finalInventory = [];
    }
    return finalInventory;
  }

  static async getHighestListedPrice(req, res, next) {
    try {
      const { dapp, query } = req;
      const { root } = query;

      if (!root) {
        return rest.response.status400(res, "Root parameter is required");
      }

      const inventoryData = await dapp.getMarketplaceInventoriesLoggedIn({
        root,
      });

      let highestPrice = 0;

      // Check if inventoryData has an 'inventoryResults' property
      const inventories = inventoryData?.inventoryResults || [];

      if (Array.isArray(inventories)) {
        inventories.forEach((item) => {
          if (item.status === "1" && item.price) {
            const itemPrice = parseFloat(item.price);
            if (itemPrice > highestPrice) {
              highestPrice = itemPrice;
            }
          }
        });
      } else {
        console.error("Inventories is not an array:", inventories);
      }

      rest.response.status200(res, { highestPrice });
      return next();
    } catch (e) {
      console.error("Error in getHighestListedPrice:", e);
      return next(e);
    }
  }

  static async getPriceHistory(req, res, next) {
    try {
      const { dapp, query } = req;
      const { address, limit, offset, timeFilter } = query;

      if (!address) {
        return rest.response.status400(res, "Address parameter is required");
      }

      const priceHistoryData = await dapp.getPriceHistory({
        assetAddress: address,
        limit: limit,
        offset: offset,
        timeFilter: timeFilter,
      });

      return rest.response.status200(res, priceHistoryData);
    } catch (e) {
      console.error("Error in getPriceHistory:", e);
      return next(e);
    }
  }
}

export default MarketplaceController;
