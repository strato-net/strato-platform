import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class ProductFileController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params 
     
      let args
      let chainOptions = options
      
      if (address) {
        args = { address }
        chainOptions = { ...options}
      }

      const result = await dapp.getProductFile(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const productFiles = await dapp.getProductFiles({ ...query })
      rest.response.status200(res, productFiles)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      ProductFileController.validateCreateProductFileArgs(body)
    
      const result = await dapp.createProductFile(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      ProductFileController.validateUpdateProductFileArgs(body)

      const result = await dapp.updateProductFile(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async audit(req, res, next) {
    try {
      const { dapp, params } = req
      const { address, chainId } = params 

      const result = await dapp.auditProductFile( { address, chainId }, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req

      ProductFileController.validateTransferOwnershipArgs(body)
      const result = await dapp.transferOwnershipProductFile(body, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateProductFileArgs(args) {
    const createProductFileSchema = Joi.object({
      productId: Joi.string().required(),
      fileLocation: Joi.string().required(),
      fileHash: Joi.string().required(),
      fileName: Joi.string().required(),
      uploadDate: Joi.number().required(),
      section: Joi.number().required(),
      type: Joi.number().required(),
    });
    console.log("args: ", args)
    const validation = createProductFileSchema.validate(args);

    if (validation.error) {
      console.log("validation.error.message: ", validation.error.message)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create ProductFile Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateProductFileArgs(args) {
    const updateProductFileSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        fileLocation: Joi.string(),
        fileHash: Joi.string(),
        fileName: Joi.string(),
        uploadDate: Joi.number(),
        section: Joi.number(),
        type: Joi.number(),
      }).required(),
    });

    const validation = updateProductFileSchema.validate(args);

    if (validation.error) {
      console.log("validation.error.message: ", validation.error.message)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update ProductFile Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipProductFileSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    })

    const validation = transferOwnershipProductFileSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership ProductFile Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default ProductFileController
