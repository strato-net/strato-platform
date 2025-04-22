import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * @class CarbonDAOController
 * @description Controller for handling CarbonDAO-related API endpoints
 */
class CarbonDAOController {
  /**
   * @method getAll
   * @description Retrieves a list of all carbon DAOs in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of carbon DAOs to return
   * @param {number} [req.query.offset] - Number of carbon DAOs to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of carbon DAOs
   * @throws {Error} - Forwards any errors to the error handler
   */
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

  /**
   * @method create
   * @description Creates a new carbon DAO in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.body - Request body
   * @param {Object} req.body.itemArgs - Carbon DAO item arguments
   * @param {string} req.body.itemArgs.name - Name of the carbon DAO
   * @param {string} req.body.itemArgs.description - Detailed description of the carbon DAO
   * @param {number} req.body.itemArgs.quantity - Quantity of carbon credits represented by this DAO (minimum: 1)
   * @param {number} req.body.itemArgs.decimals - Number of decimal places for the carbon DAO (0-18)
   * @param {string[]} req.body.itemArgs.images - Array of image URLs for the carbon DAO
   * @param {string[]} req.body.itemArgs.files - Array of file URLs for the carbon DAO
   * @param {string[]} req.body.itemArgs.fileNames - Array of file names for the carbon DAO
   * @param {string} req.body.itemArgs.redemptionService - Service used for redeeming the carbon DAO
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created carbon DAO object
   * @throws {Error} - Forwards any errors to the error handler
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
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

  /**
   * @method validateCreateCarbonDAOArgs
   * @description Validates the arguments for creating a carbon DAO
   * @param {Object} args - Arguments to validate
   * @param {Object} args.itemArgs - Carbon DAO item arguments
   * @param {string} args.itemArgs.name - Name of the carbon DAO
   * @param {string} args.itemArgs.description - Detailed description of the carbon DAO
   * @param {number} args.itemArgs.quantity - Quantity of carbon credits represented by this DAO (minimum: 1)
   * @param {number} args.itemArgs.decimals - Number of decimal places for the carbon DAO (0-18)
   * @param {string[]} args.itemArgs.images - Array of image URLs for the carbon DAO
   * @param {string[]} args.itemArgs.files - Array of file URLs for the carbon DAO
   * @param {string[]} args.itemArgs.fileNames - Array of file names for the carbon DAO
   * @param {string} args.itemArgs.redemptionService - Service used for redeeming the carbon DAO
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
  static validateCreateCarbonDAOArgs(args) {
    const createCarbonDAOSchema = Joi.object({
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
