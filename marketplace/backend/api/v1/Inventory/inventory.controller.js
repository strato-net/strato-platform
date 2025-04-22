import { rest } from 'blockapps-rest';
import axios from 'axios';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';
import {
  TransferRecipient,
  TransferSender,
} from '../../../helpers/emailTemplates';
import sendEmail from '../../../helpers/email';
import constants from '/helpers/constants';
import BigNumber from 'bignumber.js';

/**
 * Returns the appropriate token server URL based on the network ID
 * 
 * @returns {string} The token server URL
 */
function getTokenServerUrl() {
  if (process.env.networkID === constants.prodNetworkId) {
    return constants.prodTokenServerUrl;
  } else if (process.env.networkID === constants.testnetNetworkId) {
    return constants.testTokenServerUrl;
  } else {
    return constants.prodTokenServerUrl;
  }
}

const options = { config, cacheNonce: true };

/**
 * Controller for handling Inventory-related API endpoints.
 * Provides functionality for managing inventory items including creating, retrieving,
 * updating, listing, unlisting, transferring, and bridging items.
 */
class InventoryController {
  /**
   * Retrieves a specific inventory item by its address.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the inventory item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving the inventory item
   */
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address } = params;

      let args;
      let chainOptions = options;

      if (address) {
        args = { address };
        chainOptions = { ...options };
      }

      const inventory = await dapp.getInventory(args, chainOptions);
      rest.response.status200(res, inventory);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves all inventory items in the system with optional pagination.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {number} req.query.limit - Maximum number of items to return
   * @param {number} req.query.offset - Number of items to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving inventory items
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { limit, offset, ...restQuery } = query;

      const inventories = await dapp.getInventories({ ...restQuery });
      const inventoriesWithImageUrl = inventories?.inventories;
      const paginatedInventories = inventoriesWithImageUrl.slice(
        offset,
        parseInt(offset) + parseInt(limit)
      );

      rest.response.status200(res, {
        inventoriesWithImageUrl: paginatedInventories,
        count: inventories.inventoryCount,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves all inventory items owned by the authenticated user.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {number} req.query.limit - Maximum number of items to return
   * @param {number} req.query.offset - Number of items to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving user inventory items
   */
  static async getAllUserInventories(req, res, next) {
    try {
      const { dapp, query } = req;
      const { limit, offset, ...restQuery } = query;

      const inventories = await dapp.getInventoriesForUser({ ...restQuery });
      const sortedInventories = inventories?.inventoryResults.sort((a, b) => {
        if (a.saleDate && b.saleDate) {
          return b.saleDate.localeCompare(a.saleDate);
        }
        return a.saleDate ? -1 : 1; // Move items without saleDate to the end
      });
      const paginatedInventories = sortedInventories.slice(
        offset,
        parseInt(offset) + parseInt(limit)
      );

      rest.response.status200(res, {
        inventoriesWithImageUrl: paginatedInventories,
        count: paginatedInventories.length,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new inventory item with the provided details.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body containing inventory item details
   * @param {string} req.body.productAddress - Address of the product
   * @param {number} req.body.quantity - Quantity of items
   * @param {number} req.body.decimals - Number of decimal places
   * @param {number} req.body.pricePerUnit - Price per unit
   * @param {string} req.body.batchId - Batch identifier
   * @param {number} req.body.status - Status of the inventory item (1 = active, 2 = inactive)
   * @param {string} req.body.inventoryType - Type of inventory
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error creating the inventory item
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;
      InventoryController.validateCreateInventoryArgs(body);

      const result = await dapp.createInventory(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Updates an existing inventory item.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.itemContract - Contract address
   * @param {string} req.body.itemAddress - Item address
   * @param {Object} req.body.updates - Update details
   * @param {number} req.body.updates.status - New status
   * @param {number} req.body.updates.price - New price
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error updating the inventory item
   */
  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateUpdateInventoryArgs(body);

      const result = await dapp.updateInventory(body, options);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Lists an inventory item for sale.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.assetToBeSold - Address of the asset to be sold
   * @param {Array} req.body.paymentServices - Array of payment service objects
   * @param {number} req.body.price - Price of the item
   * @param {string} req.body.quantity - Quantity to be sold
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error listing the item
   */
  static async list(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateListItemArgs(body);

      const result = await dapp.listItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Unlists an item from sale.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.saleAddress - Address of the sale to unlist
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error unlisting the item
   */
  static async unlist(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateUnlistItemArgs(body);

      const result = await dapp.unlistItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Resells a previously sold item.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.assetAddress - Address of the asset to resell
   * @param {string} req.body.quantity - Quantity to resell
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error reselling the item
   */
  static async resell(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateResellItemArgs(body);

      const result = await dapp.resellItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Transfers items between users and sends email notifications.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Array} req.body - Array of transfer objects
   * @param {string} req.body[].assetAddress - Address of the asset to transfer
   * @param {string} req.body[].newOwner - Address of the new owner
   * @param {string} req.body[].quantity - Quantity to transfer
   * @param {number} req.body[].price - Price of the transfer
   * @param {string} req.body[].senderCommonName - Common name of the sender
   * @param {string} req.body[].recipientCommonName - Common name of the recipient
   * @param {string} req.body[].itemName - Name of the item
   * @param {string} req.body[].decimal - Decimal places
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error transferring the items
   */
  static async transfer(req, res, next) {
    try {
      const { dapp, body } = req;
      InventoryController.validateTransferItemArgs(body);

      const transfers = body.map(
        ({ assetAddress, newOwner, quantity, price }) => ({
          assetAddress,
          newOwner,
          quantity,
          price,
        })
      );
      await dapp.transferItem(transfers);

      // Send individual emails to each recipient
      await Promise.all(
        body.map(
          async ({
            recipientCommonName,
            itemName,
            quantity,
            price,
            senderCommonName,
            decimal,
          }) => {
            const adjustedQuantity = new BigNumber(quantity)
              .dividedBy(new BigNumber(decimal))
              .toString();
            const adjustedTotalPrice = new BigNumber(price)
              .multipliedBy(new BigNumber(quantity))
              .toString();
            const TransferSenderTemplate = TransferSender(
              senderCommonName,
              itemName,
              adjustedQuantity,
              adjustedTotalPrice,
              recipientCommonName
            );
            const TransferRecipientTemplate = TransferRecipient(
              recipientCommonName,
              itemName,
              adjustedQuantity,
              adjustedTotalPrice,
              senderCommonName
            );
            await sendEmail(
              senderCommonName,
              'Your Item Transfer Confirmation',
              TransferSenderTemplate
            );
            await sendEmail(
              recipientCommonName,
              'You’ve Received an Item Transfer!',
              TransferRecipientTemplate
            );
          }
        )
      );

      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the list of supported tokens.
   * 
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving supported tokens
   */
  static async getSupportedTokens(req, res, next) {
    try {
      const url = await getTokenServerUrl();

      // Making a GET request to the supported tokens endpoint
      const response = await axios.get(`${url}/api/tokens/supportedTokens`, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      // Checking if the response is successful
      if (response.status !== 200) {
        throw new Error(`Failed to fetch supported tokens: ${response.status}`);
      }

      // Returning the supported tokens data
      res.status(200).json(response.data);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Bridges items to another chain.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.rootAddress - Root address
   * @param {string} req.body.assetAddress - Address of the asset to bridge
   * @param {number} req.body.quantity - Quantity to bridge
   * @param {number} req.body.price - Price of the bridge
   * @param {string} req.body.baseAddress - Base address
   * @param {string} req.body.mercataAddress - Mercata address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error bridging the items
   */
  static async bridge(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateBridgeItemArgs(body);
      const transferPayload = {
        assetAddress: body.assetAddress,
        newOwner: constants.burnAddress,
        quantity: body.quantity,
        price: body.price,
      };

      const result = await dapp.transferItem([transferPayload]);

      const payload = {
        tokenSymbol: body.rootAddress,
        quantity: body.quantity,
        baseAddress: body.baseAddress,
        transferNumber: result[0].toString(),
        mercataAddress: body.mercataAddress,
      };
      const url = await getTokenServerUrl();
      const response = await axios.post(`${url}/api/bridgeMercata`, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      rest.response.status200(res, response.data);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves all item transfer events.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering transfer events
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
   * Updates a sale record.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.saleAddress - Address of the sale to update
   * @param {Object} req.body.updates - Update details
   * @param {number} req.body.updates.status - New status
   * @param {number} req.body.updates.price - New price
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error updating the sale
   */
  static async updateSale(req, res, next) {
    try {
      const { dapp, body } = req;

      InventoryController.validateUpdateSaleArgs(body);

      const result = await dapp.updateSale(body, options);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the ownership history of items.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.originAddress - Original address
   * @param {string} req.query.minItemNumber - Minimum item number
   * @param {string} req.query.maxItemNumber - Maximum item number
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving ownership history
   */
  static async getOwnershipHistory(req, res, next) {
    try {
      const { dapp, query } = req;
      InventoryController.validateGetOwnershipHistoryArgs(query);

      const items = await dapp.getOwnershipHistory(query);
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves the price history of items.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.assetToBeSold - Asset address
   * @param {number} req.query.limit - Number of records to return
   * @param {number} req.query.offset - Number of records to skip
   * @param {string} req.query.timeFilter - Time filter
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving price history
   */
  static async getPriceHistory(req, res, next) {
    try {
      const { dapp, query } = req;
      const { assetToBeSold, limit, offset, timeFilter } = query;

      const priceHistoryData = await dapp.getPriceHistory({
        assetAddress: assetToBeSold,
        limit: limit,
        offset: offset,
        timeFilter: timeFilter,
      });

      return rest.response.status200(res, priceHistoryData);
    } catch (e) {
      console.log("Couldn't fetch price history");
      return next(e);
    }
  }

  // static async audit(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address, chainId } = params

  //     const result = await dapp.auditInventory({ address, chainId }, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating an inventory item.
   * 
   * @param {Object} args - Arguments for creating an inventory item
   * @param {string} args.productAddress - Address of the product
   * @param {number} args.quantity - Quantity of items
   * @param {number} args.decimals - Number of decimal places
   * @param {number} args.pricePerUnit - Price per unit
   * @param {string} args.batchId - Batch identifier
   * @param {number} args.status - Status of the inventory item (1 = active, 2 = inactive)
   * @param {string} args.inventoryType - Type of inventory
   * @param {Array} args.serialNumber - Array of serial number objects
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateCreateInventoryArgs(args) {
    const createInventorySchema = Joi.object({
      productAddress: Joi.string().required(),
      quantity: Joi.number().integer().min(0).required(),
      decimals: Joi.number().integer().min(0).max(18).required(),
      pricePerUnit: Joi.number().greater(0).required(),
      batchId: Joi.string().required(),
      status: Joi.number().integer().min(1).max(2).required(),
      inventoryType: Joi.string().required(),
      serialNumber: Joi.array()
        .when(Joi.array().length(0), {
          then: Joi.array().length(0).required(),
          otherwise: Joi.array()
            .length(Joi.ref('quantity'))
            .items(
              Joi.object({
                itemSerialNumber: Joi.string().required(),
                rawMaterials: Joi.array()
                  .items(
                    Joi.object({
                      rawMaterialProductName: Joi.string().required(),
                      rawMaterialProductId: Joi.string().required(),
                      rawMaterialSerialNumbers: Joi.array()
                        .items(Joi.string().required())
                        .min(1)
                        .required(),
                    })
                  )
                  .required(),
              })
            )
            .required(),
        })
        .required(),
    });

    const validation = createInventorySchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Inventory Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateInventoryArgs(args) {
    const updateInventorySchema = Joi.object({
      itemContract: Joi.string().required(),
      itemAddress: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().min(1).required(),
        price: Joi.number().positive().min(1).required(),
      }).required(),
    });

    const validation = updateInventorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Inventory Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateListItemArgs(args) {
    const listItemSchema = Joi.object({
      assetToBeSold: Joi.string().required(),
      paymentServices: Joi.array()
        .min(1)
        .items(
          Joi.object({
            creator: Joi.string().required(),
            serviceName: Joi.string().required(),
          })
        )
        .required(),
      price: Joi.number().greater(0).precision(30).required(),
      quantity: Joi.string().pattern(/^\d+$/).required(),
    });

    const validation = listItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'List Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUnlistItemArgs(args) {
    const unlistItemSchema = Joi.object({
      saleAddress: Joi.string().required(),
    });

    const validation = unlistItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Unlist Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateResellItemArgs(args) {
    const resellItemSchema = Joi.object({
      assetAddress: Joi.string().required(),
      quantity: Joi.string().pattern(/^\d+$/).required(),
    });

    const validation = resellItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateRequestRedemptionArgs(args) {
    const requestRedemptionSchema = Joi.object({
      assetAddresses: Joi.array().items(Joi.string()),
      originAssetAddress: Joi.string().required(),
      quantity: Joi.number().integer().greater(0).required(),
      shippingAddressId: Joi.number().integer().required(),
      ownerCommonName: Joi.string().required(),
      ownerComments: Joi.string().allow(''),
    });

    const validation = requestRedemptionSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateTransferItemArgs(args) {
    const transferItemSchema = Joi.array()
      .min(1)
      .items(
        Joi.object({
          assetAddress: Joi.string().required(),
          newOwner: Joi.string().required(),
          quantity: Joi.string().pattern(/^\d+$/).required(),
          price: Joi.number().greater(0).precision(30).required(),
          senderCommonName: Joi.string().required(),
          recipientCommonName: Joi.string().required(),
          itemName: Joi.string().required(),
          decimal: Joi.string().pattern(/^\d+$/).required(),
        })
      );

    const validation = transferItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateBridgeItemArgs(args) {
    const bridgeItemSchema = Joi.object({
      rootAddress: Joi.string().required(),
      assetAddress: Joi.string().required(),
      quantity: Joi.number().integer().greater(0).required(),
      price: Joi.number().integer().min(0).required(),
      baseAddress: Joi.string().required(),
      mercataAddress: Joi.string().required(),
    });

    const validation = bridgeItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateSaleArgs(args) {
    const updateSaleItemSchema = Joi.object({
      saleAddress: Joi.string().required(),
      paymentServices: Joi.array()
        .min(1)
        .items(
          Joi.object({
            creator: Joi.string().required(),
            serviceName: Joi.string().required(),
          })
        )
        .required(),
      price: Joi.number().greater(0).precision(30).optional(),
      quantity: Joi.string().pattern(/^\d+$/).required(),
    });

    const validation = updateSaleItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Sale Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipInventorySchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    });

    const validation = transferOwnershipInventorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Transfer Ownership Inventory Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateGetOwnershipHistoryArgs(args) {
    const getOwnershipHistorySchema = Joi.object({
      originAddress: Joi.string().required(),
      minItemNumber: Joi.string().pattern(/^\d+$/).required(),
      maxItemNumber: Joi.string().pattern(/^\d+$/).required(),
    });

    const validation = getOwnershipHistorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Get Ownership History Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default InventoryController;
