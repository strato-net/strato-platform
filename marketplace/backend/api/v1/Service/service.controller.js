import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class ServiceController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address, chainId } = params 
     
      let args
      let chainOptions = options
      
      if (address) {
        args = { address }
        if (chainId) {
          chainOptions = { ...options, chainIds: [chainId] }
        }
      }

      const result = await dapp.getService(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const services = await dapp.getServices({ ...query })
      rest.response.status200(res, services)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      ServiceController.validateCreateServiceArgs(body)
    
      const result = await dapp.createService(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      ServiceController.validateUpdateServiceArgs(body)

      const result = await dapp.updateService(body, options)

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

      const result = await dapp.auditService( { address, chainId }, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req

      ServiceController.validateTransferOwnershipArgs(body)
      const result = await dapp.transferOwnershipService(body, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------
  
  static validateCreateServiceArgs(args) {
    const createServiceSchema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
      price: Joi.number().required(),
      createdDate: Joi.number().required(),
    });

    const validation = createServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Service Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateServiceArgs(args) {
    const updateServiceSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        name: Joi.string(),
        description: Joi.string(),
        price: Joi.number(),
        createdDate: Joi.number(),
      }).required(),
    });

    const validation = updateServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Service Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipServiceSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    })

    const validation = transferOwnershipServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Service Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default ServiceController
