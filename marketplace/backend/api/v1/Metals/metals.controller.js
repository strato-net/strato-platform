import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class MetalsController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const metals = await dapp.getMetals({ ...query })
      rest.response.status200(res, metals)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      MetalsController.validateCreateMetalsArgs(body)

      const result = await dapp.createMetals(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateMetalsArgs(args) {
    const createMetalsSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow("").optional(), // delete?
        name: Joi.string().required(),
        description: Joi.string().required(),
        source: Joi.string().required(),
        images: Joi.array().items(Joi.string().optional()).required(),
        price: Joi.number().positive().required(),
        paymentTypes: Joi.array().min(1).items(
          Joi.number().integer().min(0).max(5).required(),
        ).required(),
        units: Joi.integer().min(1).required(),
        unitOfMeasurement: Joi.integer().min(0).max(5).required(),
        leastSellableUnits: Joi.integer().min(1).required(),
        purity: Joi.string().required()
      }).required()
    });

    const validation = createMetalsSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Metals Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default MetalsController;
