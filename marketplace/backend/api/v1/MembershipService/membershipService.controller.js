import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class MembershipServiceController {

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

      const result = await dapp.getMembershipService(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const membershipServices = await dapp.getMembershipServices({ ...query })
      rest.response.status200(res, membershipServices)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipServiceController.validateCreateMembershipServiceArgs(body)
    
      const result = await dapp.createMembershipService(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipServiceController.validateUpdateMembershipServiceArgs(body)

      const result = await dapp.updateMembershipService(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipServiceController.validateTransferOwnershipArgs(body)
      const result = await dapp.transferOwnershipMembershipService(body, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------
  
  static validateCreateMembershipServiceArgs(args) {
    const createMembershipServiceSchema = Joi.object({
        membershipId: Joi.string().required(),
        serviceId: Joi.string().required(),
        membershipPrice: Joi.number().required(),
        discountPrice: Joi.number().required(),
        maxQuantity: Joi.number().required(),
        createdDate: Joi.number().required(),
        isActive: Joi.boolean().required(),
      })

    const validation = createMembershipServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create MembershipService Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateMembershipServiceArgs(args) {
    const updateMembershipServiceSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        membershipId: Joi.string(),
        serviceId: Joi.string(),
        membershipPrice: Joi.number(),
        discountPrice: Joi.number(),
        maxQuantity: Joi.number(),
        createdDate: Joi.number(),
        isActive: Joi.boolean(),
      }).required(),
    });

    const validation = updateMembershipServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update MembershipService Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipMembershipServiceSchema = Joi.object({
      address: Joi.string().required(),
      newOwner: Joi.string().required(),
    })

    const validation = transferOwnershipMembershipServiceSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership MembershipService Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default MembershipServiceController
