import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class UserMembershipController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
      }

      chainOptions = { ...options, chainIds: [dapp.chainId] }

      const result = await dapp.getUserMembership(args, chainOptions)

      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const result = await dapp.getUserMemberships({ ...query, chainIds: [dapp.chainId] })

      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body, address } = req

      UserMembershipController.createUserMembershipAndPermissionsArgs(body)
      const result = await dapp.createUserMembershipAndPermissions({ userAddress: address, ...body })

      rest.response.status201(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      UserMembershipController.validateUpdateUserMembershipArgs(body)

      const result = await dapp.updateUserMembership(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getUserMembershipRequest(req, res, next) {
    try {
      const { dapp, params, address } = req


      const result = await dapp.getUserMembershipRequest({ userAddress: address }, options)

      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllUserMembershipRequests(req, res, next) {
    try {
      const { dapp, query } = req

      const result = await dapp.getAllUserMembershipRequest({ ...query })

      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }


  static async createUserMembershipRequest(req, res, next) {
    try {
      const { dapp, body, address } = req

      UserMembershipController.validateCreateUserMembershipRequestArgs(body)
      const result = await dapp.createUserMembershipRequest({ ...body, userAddress: address });
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async updateUserMembershipRequest(req, res, next) {
    try {
      const { dapp, body } = req

      UserMembershipController.validateUpdateUserMembershipRequestArgs(body)

      const result = await dapp.updateUserMembershipRequest(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllCertifiers(req, res, next) {
    try {
      // console.log(getAllCertifiers)
      // process.exit()
      const { dapp, query } = req

      const result = await dapp.getAllCertifiers({ ...query })

      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }





  // ----------------------- ARG VALIDATION ------------------------

  static createUserMembershipAndPermissionsArgs(args) {
    const createUserMembershipSchema = Joi.object({
      userAddress: Joi.string().required(),
      isTradingEntity: Joi.boolean().required(),
      isCertifier: Joi.boolean().required(),
      isAdmin: Joi.boolean().required()
    }).required();

    const validation = createUserMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create UserMembership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateCreateUserMembershipRequestArgs(args) {
    const createUserMembershipRequestSchema = Joi.object({
      roles: Joi.array().min(1).items(Joi.number().integer()),
    });

    const validation = createUserMembershipRequestSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create UserMembershipRequest Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateUserMembershipRequestArgs(args) {
    const updateUserMembershipRequestSchema = Joi.object({
      userMembershipRequestAddress: Joi.string().required(),
      userMembershipEvent: Joi.number().required()
    });

    const validation = updateUserMembershipRequestSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update UserMembershipRequest Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
  static validateUpdateUserMembershipArgs(args) {
    const updateUserMembershipSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        isTradingEntity: Joi.boolean().required(),
        isCertifier: Joi.boolean().required(),
        isAdmin: Joi.boolean().required()
      }).required(),
    });

    const validation = updateUserMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update UserMembership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }


}

export default UserMembershipController
