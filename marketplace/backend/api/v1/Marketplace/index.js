import express from 'express';
import MarketplaceController from './marketplace.controller';
import { Marketplace } from '../endpoints';
import loadDapp from '../../middleware/loadDappHandler';
import authHandler from '../../middleware/authHandler';

/**
 * Express router for Marketplace-related API endpoints.
 * Handles routes for retrieving marketplace items, top selling products, 
 * token balances, and token addresses.
 */
const router = express.Router();

/**
 * @route GET /api/v1/marketplace
 * @description Retrieves a list of all marketplace items.
 * @access Public - Uses optional authentication
 * @param {boolean} [soldOut] - Filter by sold out status (query parameter)
 * @param {boolean} [forSale] - Filter by for sale status (query parameter)
 * @param {string[]} [category] - Filter by category name(s) (query parameter)
 * @param {string[]} [subCategory] - Filter by subcategory name(s) (query parameter)
 * @param {string[]} [manufacturer] - Filter by manufacturer name(s) (query parameter)
 * @param {string} [range] - Range filter for quantity and price (format: [field,min,max])
 * @param {number} [limit=10] - Maximum number of items per page (header)
 * @param {number} [offset=1] - Page number (1-indexed, header)
 * @response {200} - Success with paginated marketplace items
 *                    Returns an object with: 
 *                    - productsWithImageUrl: Array of marketplace items with detailed product info
 *                    - inventoryCount: Total count of items matching criteria
 * @response {400} - Bad request if query parameters are invalid
 * @response {500} - Server error
 */
router.get(
  Marketplace.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getAll
);

/**
 * @route GET /api/v1/marketplace/all
 * @description Retrieves a list of all marketplace items for an authenticated user.
 * @access Protected - Requires authentication
 * @param {boolean} [soldOut] - Filter by sold out status (query parameter)
 * @param {boolean} [forSale] - Filter by for sale status (query parameter)
 * @param {string[]} [category] - Filter by category name(s) (query parameter)
 * @param {string[]} [subCategory] - Filter by subcategory name(s) (query parameter)
 * @param {string[]} [manufacturer] - Filter by manufacturer name(s) (query parameter)
 * @param {string} [range] - Range filter for quantity and price (format: [field,min,max])
 * @param {number} [limit=10] - Maximum number of items per page (header)
 * @param {number} [offset=1] - Page number (1-indexed, header)
 * @response {200} - Success with paginated marketplace items
 *                    Returns an object with: 
 *                    - productsWithImageUrl: Array of marketplace items with detailed product info
 *                    - inventoryCount: Total count of items matching criteria
 * @response {400} - Bad request if query parameters are invalid
 * @response {401} - Unauthorized if user is not authenticated
 * @response {403} - Forbidden if user does not have permission
 * @response {500} - Server error
 */
router.get(
  Marketplace.getAllLoggedIn,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getAllLoggedIn
);

/**
 * @route GET /api/v1/marketplace/topselling
 * @description Retrieves a list of top selling products.
 * @access Public - Uses optional authentication
 * @param {number} [offset=0] - Offset for pagination (query parameter)
 * @param {number} [limit=25] - Maximum number of items to return (query parameter)
 * @param {string} [gtField=quantity] - Field to apply greater than filter on (query parameter)
 * @param {number} [gtValue=0] - Value for greater than filter (query parameter)
 * @response {200} - Success with array of top selling products sorted by sale date
 *                    Each product contains details including name, description, price,
 *                    quantity, images, and sale information
 * @response {400} - Bad request if query parameters are invalid
 * @response {500} - Server error
 */
router.get(
  Marketplace.getTopSellingProducts,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getTopSellingProducts
);

/**
 * @route GET /api/v1/marketplace/user/topselling
 * @description Retrieves a list of top selling products for an authenticated user.
 * @access Protected - Requires authentication
 * @param {number} [offset=0] - Offset for pagination (query parameter)
 * @param {number} [limit=25] - Maximum number of items to return (query parameter)
 * @param {string} [gtField=quantity] - Field to apply greater than filter on (query parameter)
 * @param {number} [gtValue=0] - Value for greater than filter (query parameter)
 * @response {200} - Success with array of top selling products for the user sorted by sale date
 *                    Each product contains details including name, description, price,
 *                    quantity, images, and sale information
 * @response {400} - Bad request if query parameters are invalid
 * @response {401} - Unauthorized if user is not authenticated
 * @response {403} - Forbidden if user does not have permission
 * @response {500} - Server error
 */
router.get(
  Marketplace.getTopSellingProductsLoggedIn,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getTopSellingProductsLoggedIn
);

/**
 * @route GET /api/v1/marketplace/stake
 * @description Retrieves a list of stakeable products.
 * @access Public - Uses optional authentication
 * @param {string[]} [assetAddresses] - Filter by specific asset addresses (query parameter)
 * @response {200} - Success with array of stakeable products
 *                    Products are sorted with gold-related items first, followed by
 *                    items for sale, token items, and then all other items
 * @response {400} - Bad request if query parameters are invalid
 * @response {500} - Server error
 */
router.get(
  Marketplace.getStakeableProducts,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getStakeableProducts
);

/**
 * @route GET /api/v1/marketplace/USDST
 * @description Retrieves the USDST balance for the authenticated user.
 * @access Protected - Requires authentication
 * @response {200} - Success with USDST balance as a numeric value
 * @response {401} - Unauthorized if user is not authenticated
 * @response {403} - Forbidden if user does not have permission
 * @response {500} - Server error
 */
router.get(
  Marketplace.getUSDSTBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getUSDSTBalance
);

/**
 * @route GET /api/v1/marketplace/cata
 * @description Retrieves the CATA balance for the authenticated user.
 * @access Protected - Requires authentication
 * @response {200} - Success with CATA balance as a numeric value
 * @response {401} - Unauthorized if user is not authenticated
 * @response {403} - Forbidden if user does not have permission
 * @response {500} - Server error
 */
router.get(
  Marketplace.getCataBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getCataBalance
);

// The get Marketplace.getUSDSTBalance route was duplicated here and now removed - find it above.

/**
 * @route GET /api/v1/marketplace/USDST/address
 * @description Retrieves the USDST token contract address.
 * @access Public - Uses optional authentication
 * @response {200} - Success with USDST contract address as a string
 * @response {404} - Not found if the token address is not available
 * @response {500} - Server error
 */
router.get(
  Marketplace.getUSDSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getUSDSTAddress
);

/**
 * @route GET /api/v1/marketplace/cata/address
 * @description Retrieves the CATA token contract address.
 * @access Public - Uses optional authentication
 * @response {200} - Success with CATA contract address as a string
 * @response {404} - Not found if the token address is not available
 * @response {500} - Server error
 */
router.get(
  Marketplace.getCataAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getCataAddress
);

/**
 * @route GET /api/v1/marketplace/strats/address
 * @description Retrieves the STRATS token contract address.
 * @access Public - Uses optional authentication
 * @response {200} - Success with STRATS contract address as a string
 * @response {404} - Not found if the token address is not available
 * @response {500} - Server error
 */
router.get(
  Marketplace.getStratsAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getStratsAddress
);

/**
 * @route GET /api/v1/marketplace/18DecimalPlaces
 * @description Retrieves the list of assets with 18 decimal places.
 * @access Public - Uses optional authentication
 * @response {200} - Success with an array of asset addresses that use 18 decimal places
 * @response {404} - Not found if the list is not available
 * @response {500} - Server error
 */
router.get(
  Marketplace.get18DecimalPlaces,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.get18DecimalPlaces
);

export default router;
