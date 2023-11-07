import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class MaterialsController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const materials = await dapp.getMaterials({ ...query })
      rest.response.status200(res, materials)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      MaterialsController.validateCreateMaterialsArgs(body)

      const result = await dapp.createMaterials(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateMaterialsArgs(args) {
    const createMaterialsSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow("").optional(),
        status: Joi.number().integer().min(0).max(5).required(),
        comment: Joi.string().allow("").optional(),
        itemNumber: Joi.number().integer().min(0).required(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        source: Joi.string().required(),
        images: Joi.array().items(Joi.string().optional()).required(),
        price: Joi.number().positive().required(),
        saleState: Joi.number().integer().min(0).max(3).required(),
        paymentType: Joi.number().integer().min(0).max(3).required(),
      }).required()
    });

    const validation = createMaterialsSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Materials Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default MaterialsController;
