import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class ClothingController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const clothings = await dapp.getClothings({ ...query })
      rest.response.status200(res, clothings)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      ClothingController.validateCreateClothingArgs(body)

      const result = await dapp.createClothing(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateClothingArgs(args) {
    const createClothingSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow("").optional(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        clothingType: Joi.string().required(),
        size: Joi.string().required(),
        skuNumber: Joi.string().required(),
        condition: Joi.string().required(),
        brand: Joi.string().required(),
        images: Joi.array().items(Joi.string().optional()).required(),
        price: Joi.number().positive().required(),
        units: Joi.number().positive().required(),
        paymentTypes: Joi.array().min(1).items(
          Joi.number().integer().min(0).max(5).required(),
        ).required(),
      }).required()
    });

    const validation = createClothingSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Clothing Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default ClothingController;
