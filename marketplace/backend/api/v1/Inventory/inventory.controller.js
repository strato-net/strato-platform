import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

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
      const inventoryImageUrl = getSignedUrlFromS3(inventory.imageKey, req.app.get(constants.s3ParamName))
      const result = { ...inventory, imageUrl: inventoryImageUrl }
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const inventories = await dapp.getInventories({ ...query })
      const inventoriesWithImageUrl = inventories.map(inventory => ({
        ...inventory,
        imageUrl: getSignedUrlFromS3(inventory.imageKey, req.app.get(constants.s3ParamName)
        )
      }))
      rest.response.status200(res, inventoriesWithImageUrl)

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

  static async resell(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateResellInventoryArgs(body)

      const result = await dapp.resellInventory(body)
      rest.response.status200(res, result)

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

  static async retire(req, res, next) {
    try {
      const { dapp, body } = req

      InventoryController.validateRetireCreditsArgs(body)

      const result = await dapp.retireCredits(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateInventoryArgs(args) {
    const createInventorySchema = Joi.object({
      productAddress: Joi.string().required(),
      availableQuantity: Joi.number().integer().min(0).required(),
      pricePerUnit: Joi.number().integer().greater(0).required(),
      vintage: Joi.number().integer().min(2020).max(2040).allow(0),
      status: Joi.number().integer().min(1).max(2).required(),
    });


    const validation = createInventorySchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Inventory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateResellInventoryArgs(args) {
    const resellInventorySchema = Joi.object({
      inventoryId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      price: Joi.number().integer().greater(0).required()
      
    });

    
    const validation = resellInventorySchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Resell Inventory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateInventoryArgs(args) {
    const updateInventorySchema = Joi.object({
      productAddress: Joi.string().required(),
      inventory: Joi.string(),
      updates: Joi.object({
        pricePerUnit: Joi.number().integer().greater(0).required(),
        status: Joi.number().integer().min(1).max(2)
      }).required()
    });

    const validation = updateInventorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Inventory Argument Validation Error', {
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

  static validateRetireCreditsArgs(args) {
    const retireCreditsSchema = Joi.object({
      inventoryId: Joi.string().required(),
      retiredBy: Joi.string().required(),
      retiredOnBehalfOf: Joi.string().required(),
      quantity: Joi.number().integer().min(0).required(),
      purpose: Joi.string().required()
    });

    const validation = retireCreditsSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Retire Credits Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}



export default InventoryController
