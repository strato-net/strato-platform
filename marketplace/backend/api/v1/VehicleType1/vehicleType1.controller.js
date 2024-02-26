import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class VehicleType1Controller {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const vehicles = await dapp.getVehiclesType1({ ...query })
      rest.response.status200(res, vehicles)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      VehicleType1Controller.validateCreateVehicleArgs(body)

      const result = await dapp.createVehicleType1(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateVehicleArgs(args) {
    const createVehicleSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        vehicleType: Joi.string().required(),
        seater: Joi.number().positive().required(),
        skuNumber: Joi.string().required(),
        condition: Joi.string().required(),
        brand: Joi.string().required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)),
        quantity: Joi.number().positive().required(),
        fuel:Joi.string().required(),
      }).required()
    });

    const validation = createVehicleSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Vehicle Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default VehicleType1Controller;
