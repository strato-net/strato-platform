import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class EventTypeController {

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const eventTypes = await dapp.getEventTypes({ ...query })
      rest.response.status200(res, eventTypes)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      EventTypeController.validateCreateEventTypeArgs(body)

      const result = await dapp.createEventType(body)
      rest.response.status200(res, result)

      console.log("*Event Type created*");

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateEventTypeArgs(args) {
    const createEventTypeSchema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
    });

    const validation = createEventTypeSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create EventType Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default EventTypeController
