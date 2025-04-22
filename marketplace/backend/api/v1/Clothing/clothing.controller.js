import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * Controller for handling Clothing-related API endpoints.
 * Provides functionality for retrieving and creating clothing items.
 */
class ClothingController {
  /**
   * Retrieves a list of all clothing items in the system.
   * Can be filtered by query parameters.
   * 
   * @param {Object} req - Express request object, containing dapp instance and query parameters
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering clothing items
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error retrieving clothing items
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const clothings = await dapp.getClothings({ ...query });
      rest.response.status200(res, clothings);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new clothing item in the system.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body containing clothing item details
   * @param {Object} req.body.itemArgs - Arguments for creating the clothing item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error creating the clothing item
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ClothingController.validateCreateClothingArgs(body);

      const result = await dapp.createClothing(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating a clothing item.
   * 
   * @param {Object} args - Arguments for creating a clothing item
   * @param {Object} args.itemArgs - Object containing clothing item properties
   * @param {string} args.itemArgs.name - Name of the clothing item
   * @param {string} args.itemArgs.description - Description of the clothing item
   * @param {string} args.itemArgs.clothingType - Type of clothing (e.g., shirt, pants, dress)
   * @param {string} args.itemArgs.size - Size of the clothing item
   * @param {string} args.itemArgs.skuNumber - Stock Keeping Unit number
   * @param {string} args.itemArgs.condition - Condition of the clothing item
   * @param {string} args.itemArgs.brand - Brand of the clothing item
   * @param {Array<string|null>} args.itemArgs.images - Array of image URLs
   * @param {Array<string|null>} args.itemArgs.files - Array of file URLs
   * @param {Array<string|null>} args.itemArgs.fileNames - Array of file names
   * @param {string} args.itemArgs.redemptionService - Service used for redeeming the clothing item
   * @param {number} args.itemArgs.quantity - Quantity of the clothing item (positive number)
   * @param {number} args.itemArgs.decimals - Number of decimal places (0-18)
   * @throws {rest.RestError} - If validation fails with a BAD_REQUEST status
   */
  static validateCreateClothingArgs(args) {
    const createClothingSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        clothingType: Joi.string().required(),
        size: Joi.string().required(),
        skuNumber: Joi.string().required(),
        condition: Joi.string().required(),
        brand: Joi.string().required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
        quantity: Joi.number().positive().required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
      }).required(),
    });

    const validation = createClothingSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Clothing Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ClothingController;
