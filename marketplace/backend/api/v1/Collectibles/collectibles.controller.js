import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * Controller for handling Collectibles-related API endpoints.
 * Provides functionality for retrieving and creating collectible items.
 */
class CollectibleController {
  /**
   * Retrieves a list of all collectibles in the system.
   * Can be filtered by query parameters.
   * 
   * @param {Object} req - Express request object, containing dapp instance and query parameters
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering collectibles
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving collectibles
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const collectibles = await dapp.getCollectibles({ ...query });
      rest.response.status200(res, collectibles);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new collectible item in the system.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body containing collectible item details
   * @param {Object} req.body.itemArgs - Arguments for creating the collectible item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error creating the collectible item
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      CollectibleController.validateCreateCollectibleArgs(body);

      const result = await dapp.createCollectible(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating a collectible item.
   * 
   * @param {Object} args - Arguments for creating a collectible item
   * @param {Object} args.itemArgs - Object containing collectible item properties
   * @param {string} args.itemArgs.name - Name of the collectible item
   * @param {string} args.itemArgs.description - Description of the collectible item
   * @param {string} args.itemArgs.condition - Condition of the collectible (e.g., mint, near mint, excellent)
   * @param {Array<string|null>} args.itemArgs.images - Array of image URLs
   * @param {Array<string|null>} args.itemArgs.files - Array of file URLs
   * @param {Array<string|null>} args.itemArgs.fileNames - Array of file names
   * @param {string} args.itemArgs.redemptionService - Service used for redeeming the collectible item
   * @param {number} args.itemArgs.quantity - Quantity of the collectible item (positive integer)
   * @param {number} args.itemArgs.decimals - Number of decimal places (0-18)
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateCreateCollectibleArgs(args) {
    const createCollectibleSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        condition: Joi.string().required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
      }).required(),
    });

    const validation = createCollectibleSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Collectible Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default CollectibleController;
