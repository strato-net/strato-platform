import { rest } from 'blockapps-rest';
import constants from '../../../helpers/constants';
import tokensJs from '../../../dapp/items/tokens';

/**
 * Controller for handling Marketplace-related API endpoints.
 * Provides functionality for retrieving marketplace items, top selling products,
 * balances (USDST, CATA), and token addresses.
 */
class MarketplaceController {
  /**
   * Retrieves a list of all marketplace items.
   * Can be filtered by query parameters.
   * Handles pagination using headers.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering items
   * @param {boolean} [req.query.soldOut] - Filter by sold out status
   * @param {boolean} [req.query.forSale] - Filter by for sale status
   * @param {string[]} [req.query.category] - Filter by category name(s)
   * @param {string[]} [req.query.subCategory] - Filter by subcategory name(s)
   * @param {string[]} [req.query.manufacturer] - Filter by manufacturer name(s)
   * @param {string} [req.query.range] - Range filter for quantity and price (format: [field,min,max])
   * @param {Object} req.headers - Request headers containing pagination info
   * @param {number} [req.headers.limit=10] - Maximum number of items per page
   * @param {number} [req.headers.offset=1] - Page number (1-indexed)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with object containing:
   *   - productsWithImageUrl: Array of marketplace items with detailed product info
   *   - inventoryCount: Total count of items matching criteria
   */
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

  /**
   * Retrieves a list of all marketplace items for an authenticated user.
   * Can be filtered by query parameters.
   * Handles pagination using headers.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering items
   * @param {boolean} [req.query.soldOut] - Filter by sold out status
   * @param {boolean} [req.query.forSale] - Filter by for sale status
   * @param {string[]} [req.query.category] - Filter by category name(s)
   * @param {string[]} [req.query.subCategory] - Filter by subcategory name(s)
   * @param {string[]} [req.query.manufacturer] - Filter by manufacturer name(s)
   * @param {string} [req.query.range] - Range filter for quantity and price (format: [field,min,max])
   * @param {Object} req.headers - Request headers containing pagination info
   * @param {number} [req.headers.limit=10] - Maximum number of items per page
   * @param {number} [req.headers.offset=1] - Page number (1-indexed)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with object containing:
   *   - productsWithImageUrl: Array of marketplace items with detailed product info
   *   - inventoryCount: Total count of items matching criteria
   */
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

  /**
   * Retrieves a list of top selling products in the marketplace.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering top selling products
   * @param {number} [req.query.offset=0] - Offset for pagination
   * @param {number} [req.query.limit=25] - Maximum number of items to return
   * @param {string} [req.query.gtField=quantity] - Field to apply greater than filter on
   * @param {number} [req.query.gtValue=0] - Value for greater than filter
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with an array of top selling products sorted by sale date. Each product contains
   *   details including name, description, price, quantity, images, and sale information.
   */
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

  /**
   * Retrieves a list of top selling products for an authenticated user.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering top selling products
   * @param {number} [req.query.offset=0] - Offset for pagination
   * @param {number} [req.query.limit=25] - Maximum number of items to return
   * @param {string} [req.query.gtField=quantity] - Field to apply greater than filter on
   * @param {number} [req.query.gtValue=0] - Value for greater than filter
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with an array of top selling products for the user sorted by sale date. Each product
   *   contains details including name, description, price, quantity, images, and sale information.
   */
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

  /**
   * Sorts inventory data, moving 'gold' and 'goldst' items to the beginning,
   * followed by items on sale, items with names in the tokens list, and then the rest.
   * 
   * @param {Array} inventoryData - The inventory data array to sort.
   * @returns {Array} - The sorted inventory data array with the following priority order:
   *   1. Items with name 'gold' or 'goldst'
   *   2. Items with a truthy 'sale' property
   *   3. Items whose name exists in tokensNamesSet
   *   4. All other items
   */
  movingGoldToFirst(inventoryData) {
    const inventoryDataCopy = JSON.parse(JSON.stringify(inventoryData));
    // Create a set of token names from constants.tokensArray
    const tokensNamesSet = new Set(constants.tokensArray.map(token => token.name.toLowerCase()));
    
    // Partition items into four buckets:
    // Bucket 1: Items with name 'gold' or 'goldst'
    // Bucket 2: Items with a truthy 'sale' property
    // Bucket 3: Items whose name exists in tokensNamesSet
    // Bucket 4: All other items
    const bucketGold = [];
    const bucketSale = [];
    const bucketTokenNames = [];
    const bucketRest = [];
    
    inventoryDataCopy.forEach(item => {
      const name = item.name?.toLowerCase();
      if (name === 'gold' || name === 'goldst') {
        bucketGold.push(item);
      } else if (item.sale) {
        bucketSale.push(item);
      } else if (tokensNamesSet.has(name)) {
        bucketTokenNames.push(item);
      } else {
        bucketRest.push(item);
      }
    });
    
    return [...bucketGold, ...bucketSale, ...bucketTokenNames, ...bucketRest];
  }

  /**
   * Retrieves a list of stakeable products.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {string[]} [req.query.assetAddresses] - Filter by specific asset addresses
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with an array of stakeable products sorted with gold-related items first, followed
   *   by items for sale, token items, and then all other items.
   */
  static async getStakeableProducts(req, res, next) {
    try {
      const { dapp } = req;
      const inventories = await dapp.getStakeableProducts();
      const updatedInventory = new MarketplaceController().movingGoldToFirst(inventories);
      rest.response.status200(res, updatedInventory);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the USDST balance for the authenticated user.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {string} req.address - User address for balance lookup
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with the USDST balance as a numeric value.
   */
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

  /**
   * Retrieves the CATA balance for the authenticated user.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {string} req.address - User address for balance lookup
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with the CATA balance as a numeric value.
   */
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

  /**
   * Retrieves the USDST token contract address.
   * 
   * @param {Object} _ - Express request object (unused)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with the USDST contract address as a string.
   */
  static async getUSDSTAddress(_, res, next) {
    try {
      const address = tokensJs.getUSDSTAddress();
      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the STRATS token contract address.
   * 
   * @param {Object} _ - Express request object (unused)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with the STRATS contract address as a string.
   */
  static async getStratsAddress(_, res, next) {
    try {
      const address = tokensJs.getStratsAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the list of assets with 2 decimal places.
   * 
   * @param {Object} _ - Express request object (unused)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with an array of asset addresses that use 2 decimal places.
   */
  static async get2DecimalPlaces(_, res, next) {
    try {
      const addresses = constants.AssetsWithTwoDecimalPlaces;
      return rest.response.status200(res, addresses);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the list of assets with 18 decimal places.
   * 
   * @param {Object} _ - Express request object (unused)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with an array of asset addresses that use 18 decimal places.
   */
  static async get18DecimalPlaces(_, res, next) {
    try {
      const addresses = constants.AssetsWithEighteenDecimalPlaces;
      return rest.response.status200(res, addresses);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the CATA token contract address.
   * 
   * @param {Object} _ - Express request object (unused)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with the CATA contract address as a string.
   */
  static async getCataAddress(_, res, next) {
    try {
      const address = tokensJs.getCataAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Filters and sorts inventory based on sale status (forSale, soldOut).
   * 
   * @param {Object} inventories - The inventory data object containing inventoryResults
   * @param {string|boolean} forSale - Filter for items currently for sale ('true' or true to include)
   * @param {string|boolean} soldOut - Filter for items that are sold out ('true' or true to include)
   * @returns {Array} - The filtered and sorted final inventory array with the following combinations:
   *   - forSale='true' and soldOut='true': Returns both listed and unlisted items
   *   - forSale='true' and soldOut='false': Returns only listed items
   *   - forSale='false' and soldOut='true': Returns only unlisted items
   *   - Any other combination: Returns an empty array
   */
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
