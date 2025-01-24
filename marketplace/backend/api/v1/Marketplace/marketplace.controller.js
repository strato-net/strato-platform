import { rest } from 'blockapps-rest';
import constants from '../../../helpers/constants';
import tokensJs from '../../../dapp/items/tokens';

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

  static async getStakeableProducts(req, res, next) {
    try {
      const { dapp, query } = req;
      const inventories = await dapp.getStakeableProducts({
        ...query,
      });

      rest.response.status200(res, inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getUSDSTBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      let USDSTBalance = 0;

      USDSTBalance = await dapp.getUSDSTBalance({ userAddress: userAddress });

      return rest.response.status200(res, USDSTBalance);
    } catch (e) {
      return next(e);
    }
  }

  static async getCataBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      let cataBalance = 0;

      cataBalance = await dapp.getCataBalance({ userAddress: userAddress });

      return rest.response.status200(res, cataBalance);
    } catch (e) {
      return next(e);
    }
  }

  static async getUSDSTAddress(_, res, next) {
    try {
      const address = tokensJs.getUSDSTAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  static async getStratsAddress(_, res, next) {
    try {
      const address = tokensJs.getStratsAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  static async get18DecimalPlaces(_, res, next) {
    try {
      const addresses = constants.AssetsWithEighteenDecimalPlaces;
      return rest.response.status200(res, addresses);
    } catch (e) {
      return next(e);
    }
  }

  static async getCataAddress(__html, res, next) {
    try {
      const address = tokensJs.getCataAddress();

      return rest.response.status200(res, address);
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
