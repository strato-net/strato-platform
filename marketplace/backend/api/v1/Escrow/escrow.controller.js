import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

/**
 * Controller for handling Escrow-related API endpoints.
 * Provides functionality for retrieving escrow information and reward data.
 */
class EscrowController {
  /**
   * Retrieves escrow information for a specific asset by its root address.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.assetRootAddress - Blockchain address of the asset root
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving the escrow information
   */
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

  /**
   * Retrieves CATA token rewards for the authenticated user.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving the CATA rewards
   */
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
  /**
   * Validates the arguments for retrieving escrow information for an asset.
   * 
   * @param {Object} args - Arguments for retrieving escrow information
   * @param {string} args.assetRootAddress - Blockchain address of the asset root
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateGetForAssetArgs(args) {
    const schema = Joi.object({
      assetRootAddress: Joi.string().required().messages({
        'any.required': 'assetRootAddress is required and must be a string.',
        'string.base': 'assetRootAddress must be a valid string.',
      }),
    });
    EscrowController.validateArgs(args, schema, 'GetForAsset');
  }

  /**
   * Validates the arguments for retrieving CATA rewards.
   * 
   * @param {Object} args - Arguments for retrieving CATA rewards
   * @param {string} args.userCommonName - Common name of the user
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateGetCataRewardsArgs(args) {
    const schema = Joi.object({
      userCommonName: Joi.string().required().messages({
        'any.required': 'userCommonName is required and must be a string.',
        'string.base': 'userCommonName must be a valid string.',
      }),
    });
    EscrowController.validateArgs(args, schema, 'GetRewards');
  }

  /**
   * Generic method to validate arguments against a Joi schema.
   * 
   * @param {Object} args - Arguments to validate
   * @param {Object} schema - Joi schema to validate against
   * @param {string} action - Name of the action being validated (for error messages)
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
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
