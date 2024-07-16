import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class TokensController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const tokens = await dapp.getTokens({ ...query })
      rest.response.status200(res, tokens)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      TokensController.validateCreateTokensArgs(body)

      const result = await dapp.createTokens(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
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
      }).required()
    });

    const validation = createTokensSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Tokens Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default TokensController;
