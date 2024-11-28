import { rest } from 'blockapps-rest';
import constants from '../../../helpers/constants';
import STRATSJs from '../../../dapp/items/STRATS';
import Decimal from "decimal.js";

class MarketplaceController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { soldOut, forSale, ...restQuery } = query;
      const limit = parseInt(req.headers['limit']) || 10;
      const offset = (parseInt(req.headers['offset']) - 1 || 0) * limit;

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
      const limit = parseInt(req.headers['limit']) || 10;
      const offset = (parseInt(req.headers['offset']) - 1 || 0) * limit;
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

  static async getCataBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      let cataBalance = 0;

      cataBalance = await dapp.getCataBalance({ userAddress: userAddress });
      const divisorStr = 10 ** 18;
      cataBalance = new Decimal(cataBalance).dividedBy(new Decimal(divisorStr));
      cataBalance = cataBalance.toFixed(2);

      return rest.response.status200(res, cataBalance);
    } catch (e) {
      return next(e);
    }
  }

  static async getStratsAddress(req, res, next) {
    try {
      const address = await STRATSJs.getStratsAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
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
    if (forSale === 'true' && soldOut === 'true') {
      finalInventory = [...listed, ...unlisted];
    } else if (forSale === 'true' && soldOut === 'false') {
      finalInventory = [...listed];
    } else if (forSale === 'false' && soldOut === 'true') {
      finalInventory = [...unlisted];
    } else {
      finalInventory = [];
    }
    return finalInventory;
  }
}

export default MarketplaceController;
