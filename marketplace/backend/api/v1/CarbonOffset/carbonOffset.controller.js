import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class CarbonOffsetController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const carbonOffsets = await dapp.getCarbonOffsets({ ...query });
      rest.response.status200(res, carbonOffsets);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      CarbonOffsetController.validateCreateCarbonOffsetArgs(body);

      const result = await dapp.createCarbonOffset(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateCarbonOffsetArgs(args) {
    const createCarbonOffsetSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createCarbonOffsetSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create CarbonOffset Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default CarbonOffsetController;
