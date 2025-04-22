import express from 'express';
import InventoryController from './inventory.controller';
import { Inventory } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for Inventory-related API endpoints.
 * Sets up routes for managing inventory items, including creating, retrieving,
 * updating, listing, unlisting, transferring, and bridging inventory items.
 */
const router = express.Router();

/**
 * GET /api/v1/inventory/supportedTokens
 * Route to retrieve the list of supported tokens.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @returns {Array} List of supported token objects with address, name, symbol, and bridgeableToChains properties
 */
router.get(
  Inventory.supportedTokens,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getSupportedTokens
);

/**
 * GET /api/v1/inventory/:address
 * Route to retrieve a specific inventory item by its address.
 * Uses optional auth (can be accessed by non-authenticated users)
 * and loads the dapp instance before passing to the controller.
 * 
 * @param {string} address - Blockchain address of the inventory item (path parameter)
 * @returns {Object} The inventory item details
 */
router.get(
  Inventory.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.get
);

/**
 * GET /api/v1/inventory
 * Route to retrieve all inventory items in the system with optional pagination.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {number} limit - Maximum number of items to return (query parameter)
 * @param {number} offset - Number of items to skip (query parameter)
 * @returns {Object} Object containing inventoriesWithImageUrl array and count of total items
 */
router.get(
  Inventory.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAll
);

/**
 * GET /api/v1/inventory/user/inventories
 * Route to retrieve all inventory items owned by the authenticated user.
 * Uses optional auth and loads the dapp instance before passing to the controller.
 * 
 * @param {number} limit - Maximum number of items to return (query parameter)
 * @param {number} offset - Number of items to skip (query parameter)
 * @returns {Object} Object containing inventoriesWithImageUrl array and count of user's items
 */
router.get(
  Inventory.getAllUserInventories,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getAllUserInventories
);

/**
 * GET /api/v1/inventory/ownership/history
 * Route to retrieve the ownership history of items.
 * Uses optional auth and loads the dapp instance before passing to the controller.
 * 
 * @param {string} originAddress - Original address (query parameter)
 * @param {string} minItemNumber - Minimum item number (query parameter)
 * @param {string} maxItemNumber - Maximum item number (query parameter)
 * @returns {Array} Array of ownership history records
 */
router.get(
  Inventory.getOwnershipHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getOwnershipHistory
);

/**
 * POST /api/v1/inventory
 * Route to create a new inventory item with the provided details.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.productAddress - Address of the product
 * @param {number} body.quantity - Quantity of items
 * @param {number} body.decimals - Number of decimal places
 * @param {number} body.pricePerUnit - Price per unit
 * @param {string} body.batchId - Batch identifier
 * @param {number} body.status - Status of the inventory item (1 = active, 2 = inactive)
 * @param {string} body.inventoryType - Type of inventory
 * @param {Array} [body.serialNumber] - Array of serial number objects
 * @returns {Object} The created inventory item
 */
router.post(
  Inventory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.create
);

/**
 * POST /api/v1/inventory/list
 * Route to list an inventory item for sale.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.assetToBeSold - Address of the asset to be sold
 * @param {Array} body.paymentServices - Array of payment service objects
 * @param {string} body.paymentServices[].creator - Creator address
 * @param {string} body.paymentServices[].serviceName - Name of the payment service
 * @param {number} body.price - Price of the item
 * @param {string} body.quantity - Quantity to be sold
 * @returns {Object} Result of the listing operation
 */
router.post(
  Inventory.list,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.list
);

/**
 * POST /api/v1/inventory/unlist
 * Route to remove an item from being listed for sale.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.saleAddress - Address of the sale to unlist
 * @returns {Object} Result of the unlisting operation
 */
router.post(
  Inventory.unlist,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.unlist
);

/**
 * POST /api/v1/inventory/resell
 * Route to resell a previously sold item.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.assetAddress - Address of the asset to resell
 * @param {string} body.quantity - Quantity to resell
 * @returns {Object} Result of the resell operation
 */
router.post(
  Inventory.resell,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.resell
);

/**
 * POST /api/v1/inventory/transfer
 * Route to transfer items between users.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Array} body - Array of transfer objects
 * @param {string} body[].assetAddress - Address of the asset to transfer
 * @param {string} body[].newOwner - Address of the new owner
 * @param {string} body[].quantity - Quantity to transfer
 * @param {number} body[].price - Price of the transfer
 * @param {string} body[].senderCommonName - Common name of the sender
 * @param {string} body[].recipientCommonName - Common name of the recipient
 * @param {string} body[].itemName - Name of the item
 * @param {string} body[].decimal - Decimal places
 * @returns {Object} Success response
 */
router.post(
  Inventory.transfer,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.transfer
);

/**
 * POST /api/v1/inventory/bridge
 * Route to bridge items to another chain.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.rootAddress - Root address
 * @param {string} body.assetAddress - Address of the asset to bridge
 * @param {number} body.quantity - Quantity to bridge
 * @param {number} body.price - Price of the bridge
 * @param {string} body.baseAddress - Base address
 * @param {string} body.mercataAddress - Mercata address
 * @returns {Object} Result of the bridge operation
 */
router.post(
  Inventory.bridge,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.bridge
);

/**
 * GET /api/v1/inventory/transfers/items
 * Route to retrieve all item transfer events.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {string} [fromAddress] - Filter transfers by sender address (query parameter)
 * @param {string} [toAddress] - Filter transfers by recipient address (query parameter)
 * @returns {Array} Array of item transfer events
 */
router.get(
  Inventory.transferredItems,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAllItemTransferEvents
);

/**
 * PUT /api/v1/inventory/update
 * Route to update an existing inventory item.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.itemContract - Contract address
 * @param {string} body.itemAddress - Item address
 * @param {Object} body.updates - Update details
 * @param {number} body.updates.status - New status
 * @param {number} body.updates.price - New price
 * @returns {Object} Updated inventory item
 */
router.put(
  Inventory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.update
);

/**
 * PUT /api/v1/inventory/updateSale
 * Route to update a sale record.
 * Requires authentication and loads the dapp instance before 
 * passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.saleAddress - Address of the sale to update
 * @param {Array} body.paymentServices - Array of payment service objects
 * @param {string} body.paymentServices[].creator - Creator address
 * @param {string} body.paymentServices[].serviceName - Name of the payment service
 * @param {number} [body.price] - New price
 * @param {string} body.quantity - New quantity
 * @returns {Object} Result of the update operation
 */
router.put(
  Inventory.updateSale,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.updateSale
);

/**
 * GET /api/v1/inventory/price/history
 * Route to retrieve the price history of items.
 * Uses optional auth and loads the dapp instance before passing to the controller.
 * 
 * @param {string} assetToBeSold - Asset address (query parameter)
 * @param {number} [limit] - Number of records to return (query parameter)
 * @param {number} [offset] - Number of records to skip (query parameter)
 * @param {string} [timeFilter] - Time filter (query parameter)
 * @returns {Object} Object containing price history data
 */
router.get(
  Inventory.getPriceHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getPriceHistory
);

export default router;
