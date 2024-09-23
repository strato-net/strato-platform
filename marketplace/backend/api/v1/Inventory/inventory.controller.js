import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class InventoryController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
        chainOptions = { ...options }
      }

      const inventory = await dapp.getInventory(args, chainOptions)
      rest.response.status200(res, inventory)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const inventories = await dapp.getInventories({ ...query })
      const inventoriesWithImageUrl = inventories?.inventories
      rest.response.status200(res, { inventoriesWithImageUrl: inventoriesWithImageUrl, count: inventories.inventoryCount })

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllUserInventories(req, res, next) {
    try {
      const { dapp, query } = req
      const { gtField, gtValue, ...restQuery } = query;

      const inventories = await dapp.getInventoriesForUser({ userProfileGtField: gtField, userProfileGtValue: gtValue, ...restQuery });
      const sortedInventories = inventories?.inventoryResults.sort((a, b) => {
        if (a.saleDate && b.saleDate) {
          return b.saleDate.localeCompare(a.saleDate);
        }
        return a.saleDate ? -1 : 1; // Move items without saleDate to the end
      });

      rest.response.status200(res, { inventoriesWithImageUrl: sortedInventories, count: sortedInventories.length })


      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req
      InventoryController.validateCreateInventoryArgs(body)

      const result = await dapp.createInventory(body)
      rest.response.status200(res, result)

      console.log("*Seller listed item*");

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateUpdateInventoryArgs(body)

      const result = await dapp.updateInventory(body, options)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async list(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateListItemArgs(body)

      const result = await dapp.listItem(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async unlist(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateUnlistItemArgs(body)

      const result = await dapp.unlistItem(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async resell(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateResellItemArgs(body)

      const result = await dapp.resellItem(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async transfer(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateTransferItemArgs(body)

      const result = await dapp.transferItem(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllItemTransferEvents(req, res, next) {
    try {
      const { dapp, query } = req
      const itemTransfers = await dapp.getAllItemTransferEvents(query)

      rest.response.status200(res, itemTransfers)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async updateSale(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateUpdateSaleArgs(body)

      const result = await dapp.updateSale(body, options)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getOwnershipHistory(req, res, next) {
    try {
      const { dapp, query } = req
      InventoryController.validateGetOwnershipHistoryArgs(query)

      const items = await dapp.getOwnershipHistory(query)
      rest.response.status200(res, items)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getPriceHistory(req, res, next) {
    try {
      const { dapp, query } = req
      const { assetToBeSold, limit, offset, timeFilter } = query;

      const priceHistoryData = await dapp.getPriceHistory({ assetAddress: assetToBeSold, limit: limit, offset: offset, timeFilter: timeFilter });

      return rest.response.status200(res, priceHistoryData)
    } catch (e) {
      console.log("Couldn't fetch price history");
      return next(e)
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

  static validateCreateInventoryArgs(args) {
    const createInventorySchema = Joi.object({
      productAddress: Joi.string().required(),
      quantity: Joi.number().integer().min(0).required(),
      pricePerUnit: Joi.number().greater(0).required(),
      batchId: Joi.string().required(),
      status: Joi.number().integer().min(1).max(2).required(),
      inventoryType: Joi.string().required(),
      serialNumber: Joi.array().when(Joi.array().length(0), {
        then: Joi.array().length(0).required(),
        otherwise: Joi.array().length(Joi.ref('quantity')).items(Joi.object({
          itemSerialNumber: Joi.string().required(),
          rawMaterials: Joi.array().items(Joi.object({
            rawMaterialProductName: Joi.string().required(),
            rawMaterialProductId: Joi.string().required(),
            rawMaterialSerialNumbers: Joi.array().items(Joi.string().required()).min(1).required()
          })).required()
        })).required()
      }).required(),
    });


    const validation = createInventorySchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Inventory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateInventoryArgs(args) {
    const updateInventorySchema = Joi.object({
      itemContract: Joi.string().required(),
      itemAddress: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().min(1).required(),
        price: Joi.number().positive().min(1).required()
      }).required()
    });

    const validation = updateInventorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Inventory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateListItemArgs(args) {
    const listItemSchema = Joi.object({
      assetToBeSold: Joi.string().required(),
      paymentServices: Joi.array().min(1).items(
        Joi.object({
            creator: Joi.string().required(),
            serviceName: Joi.string().required(),
        })
      ).required(),
      price: Joi.number().greater(0).precision(4).required(),
      quantity: Joi.number().integer().greater(0).optional(),
    });

    const validation = listItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'List Item Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUnlistItemArgs(args) {
    const unlistItemSchema = Joi.object({
      saleAddress: Joi.string().required(),
    });

    const validation = unlistItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Unlist Item Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateResellItemArgs(args) {
    const resellItemSchema = Joi.object({
      assetAddress: Joi.string().required(),
      quantity: Joi.number().integer().greater(0).required(),
    });

    const validation = resellItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateRequestRedemptionArgs(args) {
    const requestRedemptionSchema = Joi.object({
      assetAddresses: Joi.array().items(Joi.string()),
      originAssetAddress: Joi.string().required(),
      quantity: Joi.number().integer().greater(0).required(),
      shippingAddressId: Joi.number().integer().required(),
      ownerCommonName: Joi.string().required(),
      ownerComments: Joi.string().allow("")
    });

    const validation = requestRedemptionSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferItemArgs(args) {
    const transferItemSchema = Joi.object({
      assetAddress: Joi.string().required(),
      newOwner: Joi.string().required(),
      quantity: Joi.number().integer().greater(0).required(),
      price: Joi.number().greater(0).precision(4).required(),
    });

    const validation = transferItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateSaleArgs(args) {
    const updateSaleItemSchema = Joi.object({
      saleAddress: Joi.string().required(),
      paymentServices: Joi.array().min(1).items(
        Joi.object({
            creator: Joi.string().required(),
            serviceName: Joi.string().required(),
        })
      ).required(),
      price: Joi.number().greater(0).precision(4).optional(),
      quantity: Joi.number().integer().greater(0).optional(),
    });

    const validation = updateSaleItemSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Sale Item Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipInventorySchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required()
    })

    const validation = transferOwnershipInventorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Inventory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateGetOwnershipHistoryArgs(args) {
    const getOwnershipHistorySchema = Joi.object({
      originAddress: Joi.string().required(),
      minItemNumber: Joi.number().min(0).required(),
      maxItemNumber: Joi.number().min(0).required(),
    });

    const validation = getOwnershipHistorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Get Ownership History Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default InventoryController
