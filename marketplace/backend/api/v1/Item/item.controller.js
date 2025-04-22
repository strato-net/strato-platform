import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * Controller for handling Item-related API endpoints.
 * Provides functionality for managing items including creating, retrieving, 
 * updating, auditing, and transferring ownership of items.
 */
class ItemController {
  //unused route
  // static async get(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address } = params

  //     let args
  //     let chainOptions = options

  //     if (address) {
  //       args = { address }
  //       chainOptions = { ...options, chainIds: [dapp.chainId] }
  //     }

  //     const result = await dapp.getItem(args, chainOptions)
  //     rest.response.status200(res, result)

  //     return next()
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  /**
   * Retrieves a list of all items in the system.
   * Can be filtered by query parameters like status and owner.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of items to return
   * @param {number} [req.query.offset] - Number of items to skip
   * @param {number} [req.query.status] - Filter items by status (1 = active, 2 = inactive, 3 = pending, 4 = completed)
   * @param {string} [req.query.owner] - Filter items by owner address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving items
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const items = await dapp.getItems({ ...query });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the ownership history of a specific item by its blockchain address.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving ownership history
   */
  static async getOwnershipHistory(req, res, next) {
    try {
      const { dapp, params } = req;
      console.log('#### I am coming here for some reason?');
      ItemController.validateGetItemOwnershipHistoryArgs(params);
      const { address } = params;

      const items = await dapp.getItemOwnershipHistory({
        itemAddress: address,
      });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves all item transfer events.
   * Can be filtered by query parameters like fromAddress and toAddress.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of transfer events to return
   * @param {number} [req.query.offset] - Number of transfer events to skip
   * @param {string} [req.query.fromAddress] - Filter transfers by sender address
   * @param {string} [req.query.toAddress] - Filter transfers by recipient address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving transfer events
   */
  static async getAllItemTransferEvents(req, res, next) {
    try {
      const { dapp, query } = req;

      const itemTransfers = await dapp.getAllItemTransferEvents(query);

      rest.response.status200(res, itemTransfers);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new item in the system.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {Object} req.body.itemArgs - Arguments for creating the item
   * @param {string} req.body.itemArgs.productId - ID of the product associated with this item
   * @param {string} req.body.itemArgs.inventoryId - ID of the inventory this item belongs to
   * @param {string} req.body.itemArgs.serialNumber - Serial number of the item
   * @param {number} req.body.itemArgs.status - Status of the item (1 = active, 2 = inactive, 3 = pending, 4 = completed)
   * @param {string} req.body.itemArgs.comment - Comment associated with the item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error creating the item
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateCreateItemArgs(body);

      const result = await dapp.addItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Updates an existing item in the system.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.itemAddress - Blockchain address of the item to update
   * @param {Object} req.body.updates - Update details
   * @param {number} [req.body.updates.status] - New status of the item (1 = active, 2 = inactive, 3 = pending, 4 = completed)
   * @param {string} [req.body.updates.comment] - New comment for the item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error updating the item
   */
  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateUpdateItemArgs(body);

      const result = await dapp.updateItem(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves audit information for a specific item.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the item
   * @param {string} req.params.chainId - Chain ID of the blockchain where the item is deployed
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving audit information
   */
  static async audit(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address, chainId } = params;

      const result = await dapp.auditItem({ address, chainId }, options);
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Transfers ownership of an item to a new owner.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.inventoryId - ID of the inventory containing the items to transfer
   * @param {Array<string>} req.body.itemsAddress - Array of blockchain addresses of the items to transfer
   * @param {string} req.body.newOwner - Blockchain address of the new owner
   * @param {number} req.body.newquantity - Quantity of items to transfer
   * @param {number} req.body.decimals - Number of decimal places for the item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error transferring ownership
   */
  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateTransferOwnershipArgs(body);
      const result = await dapp.transferOwnershipItem(body, options);
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves all raw materials in the system.
   * Can be filtered by query parameters.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of raw materials to return
   * @param {number} [req.query.offset] - Number of raw materials to skip
   * @param {string} [req.query.owner] - Filter raw materials by owner address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving raw materials
   */
  static async getAllRawMaterials(req, res, next) {
    try {
      const { dapp, query } = req;

      const items = await dapp.getRawMaterials({ ...query });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating an item.
   * 
   * @param {Object} args - Arguments for creating an item
   * @param {Object} args.itemArgs - Item creation arguments
   * @param {string} args.itemArgs.productId - ID of the product associated with this item
   * @param {string} args.itemArgs.inventoryId - ID of the inventory this item belongs to
   * @param {string} args.itemArgs.serialNumber - Serial number of the item
   * @param {number} args.itemArgs.status - Status of the item (1 = active, 2 = inactive, 3 = pending, 4 = completed)
   * @param {string} args.itemArgs.comment - Comment associated with the item
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateCreateItemArgs(args) {
    const createItemSchema = Joi.object({
      itemArgs: Joi.object({
        productId: Joi.string().required(),
        inventoryId: Joi.string().required(),
        serialNumber: Joi.string().required(),
        status: Joi.number().integer().min(1).max(4).required(),
        comment: Joi.string().required(),
      }),
    });

    const validation = createItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates the arguments for retrieving item ownership history.
   * 
   * @param {Object} args - Arguments for retrieving ownership history
   * @param {string} args.address - Blockchain address of the item
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateGetItemOwnershipHistoryArgs(args) {
    const getItemOwnershipHistorySchema = Joi.object({
      address: Joi.string().required(),
    });

    const validation = getItemOwnershipHistorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Get Item Ownership History Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates the arguments for updating an item.
   * 
   * @param {Object} args - Arguments for updating an item
   * @param {string} args.itemAddress - Blockchain address of the item to update
   * @param {Object} args.updates - Update details
   * @param {number} [args.updates.status] - New status of the item (1 = active, 2 = inactive, 3 = pending, 4 = completed)
   * @param {string} [args.updates.comment] - New comment for the item
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateUpdateItemArgs(args) {
    const updateItemSchema = Joi.object({
      itemAddress: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().integer().min(1).max(4),
        comment: Joi.string(),
      }).required(),
    });

    const validation = updateItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates the arguments for transferring item ownership.
   * 
   * @param {Object} args - Arguments for transferring ownership
   * @param {string} args.inventoryId - ID of the inventory containing the items to transfer
   * @param {Array<string>} args.itemsAddress - Array of blockchain addresses of the items to transfer
   * @param {string} args.newOwner - Blockchain address of the new owner
   * @param {number} args.newquantity - Quantity of items to transfer
   * @param {number} args.decimals - Number of decimal places for the item
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateTransferOwnershipArgs(args) {
    const transferOwnershipItemSchema = Joi.object({
      inventoryId: Joi.string().required(),
      itemsAddress: Joi.array().items(Joi.string()).required(),
      newOwner: Joi.string().required(),
      newquantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
    });

    const validation = transferOwnershipItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Transfer Ownership Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ItemController;
