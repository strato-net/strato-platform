import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class EscrowController {
  // Retrieve reserve contract using address
  static async getEscrowForAsset(req, res, next) {
    try {
      const { dapp, params } = req;
      const { assetRootAddress } = params;

      // Validate address presence and type
      EscrowController.validateGetForAssetArgs({ assetRootAddress });

      const result = await dapp.getEscrowForAsset({ assetRootAddress });
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Get CATA rewards for a user
  static async getCataRewards(req, res, next) {
    try {
      const { dapp } = req;
      const result = await dapp.userCataRewards();
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // ----------------------- ARGUMENT VALIDATION ------------------------
  static validateGetForAssetArgs(args) {
    const schema = Joi.object({
      assetRootAddress: Joi.string().required().messages({
        'any.required': 'assetRootAddress is required and must be a string.',
        'string.base': 'assetRootAddress must be a valid string.',
      }),
    });
    EscrowController.validateArgs(args, schema, 'GetForAsset');
  }

  static validateGetCataRewardsArgs(args) {
    const schema = Joi.object({
      userCommonName: Joi.string().required().messages({
        'any.required': 'userCommonName is required and must be a string.',
        'string.base': 'userCommonName must be a valid string.',
      }),
    });
    EscrowController.validateArgs(args, schema, 'GetRewards');
  }

  static validateArgs(args, schema, action) {
    const { error } = schema.validate(args);
    if (error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `${action} Argument Validation Error`,
        { message: `Invalid arguments: ${error.message}` }
      );
    }
  }
}

export default EscrowController;
