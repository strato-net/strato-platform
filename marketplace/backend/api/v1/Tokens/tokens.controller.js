import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import tokensJs from '../../../dapp/items/tokens';

class TokensController {

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      TokensController.validateCreateTokensArgs(body);

      const result = await dapp.createTokens(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getETHSTAddress(_, res, next) {
    try {
      const address = await tokensJs.getETHSTAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  static async addHash(req, res, next) {
    try {
      const { dapp, body } = req;

      TokensController.validateAddHashArgs(body);

      const result = await dapp.addHash(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateTokensArgs(args) {
    const createTokensSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        images: Joi.array().items(Joi.string()).required(),
        files: Joi.array().items(Joi.string()).required(),
        fileNames: Joi.array().items(Joi.string()).required(),
        redemptionService: Joi.string().required(),
        paymentServiceCreator: Joi.string().required(),
      }).required(),
    });

    const validation = createTokensSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Tokens Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateAddHashArgs(args) {
    const addHashSchema = Joi.object({
      userAddress: Joi.string().required(),
      txHash: Joi.string().required(),
      amount: Joi.string().required(),
    });

    const validation = addHashSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Add Hash Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

}

export default TokensController;
