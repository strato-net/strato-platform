import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class CarbonController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const carbons = await dapp.getCarbons({ ...query })
      rest.response.status200(res, carbons)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      CarbonController.validateCreateCarbonArgs(body)

      const result = await dapp.createCarbon(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateCarbonArgs(args) {
    const createCarbonSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow("").optional(),
        status: Joi.number().integer().min(0).max(5).required(),
        comment: Joi.string().allow("").optional(),
        itemNumber: Joi.number().integer().min(0).required(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        projectType: Joi.string().required(),
        images: Joi.array().items(Joi.string().optional()).required(),
        price: Joi.number().positive().required(),
        saleState: Joi.number().integer().min(0).max(3).required(),
        paymentType: Joi.number().integer().min(0).max(3).required(),
      }).required()
    });

    const validation = createCarbonSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Carbon Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default CarbonController;
