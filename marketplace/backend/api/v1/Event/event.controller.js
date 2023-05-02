import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class EventController {

  static async getInventoryEventTypes(req, res, next) {
    try {
      const { dapp, params } = req
      const { inventoryId } = params

      EventController.validateGetInventoryEventTypesArgs(params)
      let args

      if (inventoryId) {
        args = { inventoryId }
      }

      const result = await dapp.getInventoryEventTypes(args, options)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getInventoryEventTypeDetails(req, res, next) {
    try {
      const { dapp, params } = req
      const { inventoryId, eventTypeId } = params

      EventController.validateGetInventoryEventTypeDetailsArgs(params)
      let args
      let chainOptions = options

      if (inventoryId) {
        args = { inventoryId, eventTypeId }
        chainOptions = { ...options, chainIds: [dapp.chainId] }
      }

      const result = await dapp.getInventoryEventTypeDetails(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const events = await dapp.getEvents({ ...query })
      rest.response.status200(res, events)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      EventController.validateCreateEventArgs(body)

      const result = await dapp.createEvent(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async certifyEvent(req, res, next) {
    try {
      const { dapp, body } = req

      EventController.validatecertifyEventArgs(body)

      const result = await dapp.certifyEvent(body, options)

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

      const result = await dapp.auditEvent({ address, chainId }, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req

      EventController.validateTransferOwnershipArgs(body)
      const result = await dapp.transferOwnershipEvent(body, options)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateEventArgs(args) {
    const createEventSchema = Joi.object({
      eventTypeId: Joi.string().required(),
      productId: Joi.string().required(),
      date: Joi.number().required(),
      summary: Joi.string().required(),
      certifier: Joi.string().allow(""),
      serialNumbers: Joi.array().min(1).required()
    });

    const validation = createEventSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Event Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validatecertifyEventArgs(args) {
    const certifyEventSchema = Joi.object({
      eventBatchId: Joi.array().min(1).required(),
      updates: Joi.object({
        certifierComment: Joi.string().required(),
      }).required(),
    });

    const validation = certifyEventSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Event Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipEventSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    })

    const validation = transferOwnershipEventSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Event Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateGetInventoryEventTypesArgs(args) {
    const getInventoryEventTypesSchema = Joi.object({
      inventoryId: Joi.string().required(),
    })

    const validation = getInventoryEventTypesSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Inventory Event Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateGetInventoryEventTypeDetailsArgs(args) {
    const getInventoryEventTypeDetailsSchema = Joi.object({
      inventoryId: Joi.string().required(),
      eventTypeId: Joi.string().required(),
    })

    const validation = getInventoryEventTypeDetailsSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Inventory Event type details Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default EventController
