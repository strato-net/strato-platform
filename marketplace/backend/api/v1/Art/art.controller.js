import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class ArtController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const arts = await dapp.getArts({ ...query });
      rest.response.status200(res, arts);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ArtController.validateCreateArtArgs(body);

      const result = await dapp.createArt(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateArtArgs(args) {
    const createArtSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow('').optional(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        artist: Joi.string().required(),
        images: Joi.array().items(Joi.string()).required(),
        files: Joi.array().items(Joi.string()).required(),
        fileNames: Joi.array().items(Joi.string()).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createArtSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Art Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ArtController;
