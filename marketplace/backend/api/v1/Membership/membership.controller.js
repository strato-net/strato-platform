import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class MembershipController {

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

      const result = await dapp.getMembership(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const memberships = await dapp.getMemberships({ ...query })
      rest.response.status200(res, memberships)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipController.validateCreateMembershipArgs(body)
    
      const result = await dapp.createMembership(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipController.validateUpdateMembershipArgs(body)

      const result = await dapp.updateMembership(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipController.validateTransferOwnershipArgs(body)
      const result = await dapp.transferOwnershipMembership(body, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------
  
  static validateCreateMembershipArgs(args) {
    const createMembershipSchema = Joi.object({
      membershipArgs: Joi.object({
        productId: Joi.string().required(),
        timePeriodInMonths: Joi.number().required(),
        additionalInfo: Joi.string().required(),
        createdDate: Joi.number().required(),
      }),
      isPublic: Joi.boolean().required(),
    });

    const validation = createMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Membership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateMembershipArgs(args) {
    const updateMembershipSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      updates: Joi.object({
        productId: Joi.string(),
        timePeriodInMonths: Joi.number(),
        additionalInfo: Joi.string(),
        createdDate: Joi.number(),
      }).required(),
    });

    const validation = updateMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Membership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipMembershipSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    })

    const validation = transferOwnershipMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Membership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default MembershipController
