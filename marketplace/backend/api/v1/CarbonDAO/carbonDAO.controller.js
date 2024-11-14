import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class CarbonDAOController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const carbonDAOs = await dapp.getCarbonDAOs({ ...query });
      rest.response.status200(res, carbonDAOs);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      CarbonDAOController.validateCreateCarbonDAOArgs(body);

      const result = await dapp.createCarbonDAO(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateCarbonDAOArgs(args) {
    const createCarbonDAOSchema = Joi.object({
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

    const validation = createCarbonDAOSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create CarbonDAO Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default CarbonDAOController;
