import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * @class CarbonOffsetController
 * @description Controller for handling CarbonOffset-related API endpoints
 */
class CarbonOffsetController {
  /**
   * @method getAll
   * @description Retrieves a list of all carbon offsets in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of carbon offsets to return
   * @param {number} [req.query.offset] - Number of carbon offsets to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of carbon offsets
   * @throws {Error} - Forwards any errors to the error handler
   */
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

  /**
   * @method create
   * @description Creates a new carbon offset in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.body - Request body
   * @param {Object} req.body.itemArgs - Carbon offset item arguments
   * @param {string} req.body.itemArgs.name - Name of the carbon offset
   * @param {string} req.body.itemArgs.description - Detailed description of the carbon offset
   * @param {number} req.body.itemArgs.quantity - Quantity of carbon credits represented by this offset (minimum: 1)
   * @param {number} req.body.itemArgs.decimals - Number of decimal places for the carbon offset (0-18)
   * @param {string[]} req.body.itemArgs.images - Array of image URLs for the carbon offset
   * @param {string[]} req.body.itemArgs.files - Array of file URLs for the carbon offset
   * @param {string[]} req.body.itemArgs.fileNames - Array of file names for the carbon offset
   * @param {string} req.body.itemArgs.redemptionService - Service used for redeeming the carbon offset
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created carbon offset object
   * @throws {Error} - Forwards any errors to the error handler
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
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

  /**
   * @method validateCreateCarbonOffsetArgs
   * @description Validates the arguments for creating a carbon offset
   * @param {Object} args - Arguments to validate
   * @param {Object} args.itemArgs - Carbon offset item arguments
   * @param {string} args.itemArgs.name - Name of the carbon offset
   * @param {string} args.itemArgs.description - Detailed description of the carbon offset
   * @param {number} args.itemArgs.quantity - Quantity of carbon credits represented by this offset (minimum: 1)
   * @param {number} args.itemArgs.decimals - Number of decimal places for the carbon offset (0-18)
   * @param {string[]} args.itemArgs.images - Array of image URLs for the carbon offset
   * @param {string[]} args.itemArgs.files - Array of file URLs for the carbon offset
   * @param {string[]} args.itemArgs.fileNames - Array of file names for the carbon offset
   * @param {string} args.itemArgs.redemptionService - Service used for redeeming the carbon offset
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
  static validateCreateCarbonOffsetArgs(args) {
    const createCarbonOffsetSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
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
