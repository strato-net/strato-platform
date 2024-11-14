import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class SpiritsController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const spirits = await dapp.getSpirits({ ...query });
      rest.response.status200(res, spirits);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      SpiritsController.validateCreateSpiritsArgs(body);

      const result = await dapp.createSpirits(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateSpiritsArgs(args) {
    const createSpiritsSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        spiritType: Joi.string().required(),
        unitOfMeasurement: Joi.number().integer().min(0).max(8).required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createSpiritsSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Spirits Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default SpiritsController;
