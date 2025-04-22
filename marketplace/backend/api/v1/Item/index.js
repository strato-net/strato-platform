import express from 'express';
import ItemController from './item.controller';
import { Item } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for Item-related API endpoints.
 * Provides routes for managing items including retrieving, creating, 
 * updating, auditing, and transferring ownership of items.
 * All routes are protected by authentication middleware.
 */
const router = express.Router();

/**
 * @route GET /api/v1/item/getAll
 * @description Retrieves all items in the system.
 * @access Protected - Requires authentication
 * @param {number} [limit] - Maximum number of items to return
 * @param {number} [offset] - Number of items to skip
 * @param {number} [status] - Filter by item status (1=active, 2=inactive, 3=pending, 4=completed)
 * @param {string} [owner] - Filter by owner address
 * @response {200} - Success with array of items
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.get(
  Item.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ItemController.getAll
);

/**
 * @route GET /api/v1/item/ownershipHistory/:address
 * @description Retrieves the ownership history of a specific item.
 * @access Protected - Requires authentication
 * @param {string} address - Blockchain address of the item (URL parameter)
 * @response {200} - Success with ownership history data
 * @response {400} - Bad request if address is invalid
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.get(
  Item.ownershipHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  ItemController.getOwnershipHistory
);

/**
 * @route GET /api/v1/item/transferEvents
 * @description Retrieves all item transfer events in the system.
 * @access Protected - Requires authentication
 * @param {number} [limit] - Maximum number of transfer events to return
 * @param {number} [offset] - Number of transfer events to skip
 * @param {string} [fromAddress] - Filter by sender address
 * @param {string} [toAddress] - Filter by recipient address
 * @response {200} - Success with array of transfer events
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.get(
  Item.transfers,
  authHandler.authorizeRequest(true),
  loadDapp,
  ItemController.getAllItemTransferEvents
);

/**
 * @route POST /api/v1/item/create
 * @description Creates a new item in the system.
 * @access Protected - Requires authentication
 * @param {Object} itemArgs - Arguments for creating the item
 * @param {string} itemArgs.productId - ID of the product associated with this item
 * @param {string} itemArgs.inventoryId - ID of the inventory this item belongs to
 * @param {string} itemArgs.serialNumber - Serial number of the item
 * @param {number} itemArgs.status - Status of the item (1-4)
 * @param {string} itemArgs.comment - Comment associated with the item
 * @response {200} - Success with created item data
 * @response {400} - Bad request if input validation fails
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.post(
  Item.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.create
);

/**
 * @route PUT /api/v1/item/transferOwnership
 * @description Transfers ownership of an item to a new owner.
 * @access Protected - Requires authentication
 * @param {string} inventoryId - ID of the inventory containing the items to transfer
 * @param {Array<string>} itemsAddress - Array of blockchain addresses of the items to transfer
 * @param {string} newOwner - Blockchain address of the new owner
 * @param {number} newquantity - Quantity of items to transfer
 * @param {number} decimals - Number of decimal places for the item
 * @response {200} - Success with transfer result
 * @response {400} - Bad request if input validation fails
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.put(
  Item.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.transferOwnership
);

/**
 * @route POST /api/v1/item/update
 * @description Updates an existing item in the system.
 * @access Protected - Requires authentication
 * @param {string} itemAddress - Blockchain address of the item to update
 * @param {Object} updates - Update details
 * @param {number} [updates.status] - New status of the item (1-4)
 * @param {string} [updates.comment] - New comment for the item
 * @response {200} - Success with updated item data
 * @response {400} - Bad request if input validation fails
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.put(
  Item.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.update
);

/**
 * @route GET /api/v1/item/audit/:address/:chainId
 * @description Retrieves audit information for a specific item.
 * @access Protected - Requires authentication
 * @param {string} address - Blockchain address of the item (URL parameter)
 * @param {string} chainId - Chain ID of the blockchain where the item is deployed (URL parameter)
 * @response {200} - Success with audit data
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.get(Item.audit, loadDapp, ItemController.audit);

/**
 * @route GET /api/v1/item/rawMaterials
 * @description Retrieves all raw materials in the system.
 * @access Protected - Requires authentication
 * @param {number} [limit] - Maximum number of raw materials to return
 * @param {number} [offset] - Number of raw materials to skip
 * @param {string} [owner] - Filter by owner address
 * @response {200} - Success with array of raw materials
 * @response {401} - Unauthorized if not authenticated
 * @response {500} - Server error
 */
router.get(
  Item.getRawMaterials,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.getAllRawMaterials
);

export default router;
