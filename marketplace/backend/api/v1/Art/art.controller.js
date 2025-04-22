import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * @class ArtController
 * @description Controller for handling Art-related API endpoints
 */
class ArtController {
  /**
   * @method getAll
   * @description Retrieves a list of all art items in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of art items to return
   * @param {number} [req.query.offset] - Number of art items to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of arts
   * @throws {Error} - Forwards any errors to the error handler
   */
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

  /**
   * @method create
   * @description Creates a new art item in the system
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DAPP instance
   * @param {Object} req.body - Request body
   * @param {Object} req.body.itemArgs - Art item arguments
   * @param {string} [req.body.itemArgs.serialNumber] - Optional serial number for the art item
   * @param {string} req.body.itemArgs.name - Name of the art item
   * @param {string} req.body.itemArgs.description - Detailed description of the art item
   * @param {number} req.body.itemArgs.decimals - Number of decimal places (0-18)
   * @param {string} req.body.itemArgs.artist - Name of the artist who created the art item
   * @param {string[]} req.body.itemArgs.images - Array of image URLs for the art item
   * @param {string[]} req.body.itemArgs.files - Array of file URLs for the art item
   * @param {string[]} req.body.itemArgs.fileNames - Array of file names for the art item
   * @param {string} req.body.itemArgs.redemptionService - Service used for redeeming the art item
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created art object
   * @throws {Error} - Forwards any errors to the error handler
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
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

  /**
   * @method validateCreateArtArgs
   * @description Validates the arguments for creating an art item
   * @param {Object} args - Arguments to validate
   * @param {Object} args.itemArgs - Art item arguments
   * @param {string} [args.itemArgs.serialNumber] - Optional serial number for the art item
   * @param {string} args.itemArgs.name - Name of the art item
   * @param {string} args.itemArgs.description - Detailed description of the art item
   * @param {number} args.itemArgs.decimals - Number of decimal places (0-18)
   * @param {string} args.itemArgs.artist - Name of the artist who created the art item
   * @param {string[]} args.itemArgs.images - Array of image URLs for the art item
   * @param {string[]} args.itemArgs.files - Array of file URLs for the art item
   * @param {string[]} args.itemArgs.fileNames - Array of file names for the art item
   * @param {string} args.itemArgs.redemptionService - Service used for redeeming the art item
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
  static validateCreateArtArgs(args) {
    const createArtSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow('').optional(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
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
