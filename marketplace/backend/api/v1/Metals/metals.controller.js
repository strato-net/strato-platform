import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * Controller for handling Metals-related API endpoints.
 * Provides functionality for retrieving all metals and creating new metal assets.
 * Metals represent physically backed tokens for various types of metals like gold, silver, etc.
 */
class MetalsController {
  /**
   * Retrieves a list of all metals in the system.
   * Can be filtered by query parameters.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering metals
   * @param {number} [req.query.limit] - Maximum number of metals to return
   * @param {number} [req.query.offset] - Number of metals to skip
   * @param {string} [req.query.owner] - Filter metals by owner address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with array of metal objects, each containing:
   *   - address: Blockchain address of the metal
   *   - name: Name of the metal
   *   - description: Description of the metal
   *   - source: Source of the metal
   *   - quantity: Quantity of metal
   *   - decimals: Number of decimal places for the metal token
   *   - unitOfMeasurement: Unit of measurement for the metal (e.g., grams, ounces, etc.)
   *   - purity: Purity level of the metal
   *   - images: Array of image URLs for the metal
   *   - files: Array of file URLs for the metal
   *   - fileNames: Array of file names for the metal
   *   - redemptionService: Service used for redeeming the metal
   *   - owner: Current owner of the metal
   *   - createdAt: Creation timestamp of the metal
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const metals = await dapp.getMetals({ ...query });
      rest.response.status200(res, metals);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new metal in the system.
   * Validates input arguments using Joi schema.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body containing metal details
   * @param {Object} req.body.itemArgs - Metal parameters
   * @param {string} req.body.itemArgs.name - Name of the metal
   * @param {string} req.body.itemArgs.description - Detailed description of the metal
   * @param {string} req.body.itemArgs.source - Source of the metal (e.g., mine location, company)
   * @param {number} req.body.itemArgs.quantity - Quantity of metal to create (minimum: 1)
   * @param {number} req.body.itemArgs.decimals - Number of decimal places for the metal token (0-18)
   * @param {number} req.body.itemArgs.unitOfMeasurement - Unit of measurement for the metal (0-8 representing different units)
   * @param {string} req.body.itemArgs.purity - Purity level of the metal (e.g., 99.9%)
   * @param {Array<string|null>} req.body.itemArgs.images - Array of image URLs for the metal
   * @param {Array<string|null>} req.body.itemArgs.files - Array of file URLs for the metal
   * @param {Array<string|null>} req.body.itemArgs.fileNames - Array of file names for the metal
   * @param {string} req.body.itemArgs.redemptionService - Service used for redeeming the metal
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with object containing metal details:
   *   - address: Blockchain address of the created metal
   *   - name: Name of the metal
   *   - description: Description of the metal
   *   - source: Source of the metal
   *   - quantity: Quantity of metal
   *   - decimals: Number of decimal places
   *   - unitOfMeasurement: Unit of measurement code
   *   - purity: Purity level
   *   - images: Array of image URLs
   *   - files: Array of file URLs
   *   - fileNames: Array of file names
   *   - redemptionService: Service used for redemption
   *   - owner: Address of the creator/owner
   *   - createdAt: Creation timestamp
   * @throws {RestError} - Throws a RestError with BAD_REQUEST status if validation fails
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      MetalsController.validateCreateMetalsArgs(body);

      const result = await dapp.createMetals(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating a metal.
   * Uses Joi schema validation to ensure all required fields are present and correctly formatted.
   * 
   * @param {Object} args - Arguments for creating a metal
   * @param {Object} args.itemArgs - Metal parameters
   * @param {string} args.itemArgs.name - Name of the metal (required)
   * @param {string} args.itemArgs.description - Description of the metal (required)
   * @param {string} args.itemArgs.source - Source of the metal (required)
   * @param {number} args.itemArgs.quantity - Quantity of metal (required, min: 1)
   * @param {number} args.itemArgs.decimals - Decimal places (required, min: 0, max: 18)
   * @param {number} args.itemArgs.unitOfMeasurement - Unit of measurement code (required, min: 0, max: 8)
   * @param {string} args.itemArgs.purity - Purity level of the metal (required)
   * @param {Array<string|null>} args.itemArgs.images - Array of image URLs (required)
   * @param {Array<string|null>} args.itemArgs.files - Array of file URLs (required)
   * @param {Array<string|null>} args.itemArgs.fileNames - Array of file names (required)
   * @param {string} args.itemArgs.redemptionService - Redemption service (required)
   * @throws {RestError} - Throws a RestError with BAD_REQUEST status if validation fails
   * @private
   */
  static validateCreateMetalsArgs(args) {
    const createMetalsSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        source: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
        unitOfMeasurement: Joi.number().integer().min(0).max(8).required(),
        purity: Joi.string().required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createMetalsSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Metals Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default MetalsController;
