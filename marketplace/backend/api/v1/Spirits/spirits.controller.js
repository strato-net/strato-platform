/**
 * @fileoverview Spirits Controller
 * 
 * This module handles the business logic for spirit operations in the marketplace,
 * including creating and retrieving spirit assets. Spirits represent alcoholic beverages
 * like whiskey, vodka, rum, etc. that have been tokenized as digital assets on the blockchain.
 * 
 * The controller validates input parameters, interacts with the blockchain via the dapp instance,
 * and properly formats API responses. It supports operations to create new spirit assets and
 * retrieve existing ones with optional filtering.
 * 
 * @module api/v1/Spirits/SpiritsController
 * @see module:api/v1/Spirits
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

/**
 * Controller class for handling spirit-related operations
 * 
 * @class SpiritsController
 */
class SpiritsController {
  /**
   * Retrieves a list of all spirits with optional filtering
   * 
   * Returns tokenized spirit assets from the blockchain. The results can be
   * filtered by owner and paginated using limit and offset parameters.
   * Anonymous access is allowed for this endpoint.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DApp instance loaded by middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of spirits to return
   * @param {number} [req.query.offset] - Number of spirits to skip for pagination
   * @param {string} [req.query.owner] - Filter spirits by owner address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of spirits or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving the spirits
   * @see GET /spirits
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const spirits = await dapp.getSpirits({ ...query });
      rest.response.status200(res, spirits);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new spirit asset
   * 
   * Creates a new tokenized spirit asset on the blockchain. The asset represents
   * an alcoholic beverage with specific attributes like type, quantity, and unit of measurement.
   * This endpoint requires authentication and validates all input parameters before creating
   * the asset.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - DApp instance loaded by middleware
   * @param {Object} req.body - Request body
   * @param {Object} req.body.itemArgs - Spirit creation arguments
   * @param {string} req.body.itemArgs.name - Name of the spirit
   * @param {string} req.body.itemArgs.description - Description of the spirit
   * @param {number} req.body.itemArgs.quantity - Quantity of spirit to create
   * @param {number} req.body.itemArgs.decimals - Number of decimal places (0-18)
   * @param {string} req.body.itemArgs.spiritType - Type of spirit (e.g., whiskey, vodka, rum)
   * @param {number} req.body.itemArgs.unitOfMeasurement - Unit of measurement (0-8)
   * @param {string[]} req.body.itemArgs.images - Array of image URLs
   * @param {string[]} req.body.itemArgs.files - Array of file URLs
   * @param {string[]} req.body.itemArgs.fileNames - Array of file names
   * @param {string} req.body.itemArgs.redemptionService - Service used for redemption
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created spirit or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error creating the spirit
   * @see POST /spirits
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      SpiritsController.validateCreateSpiritsArgs(body);

      const result = await dapp.createSpirits(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates arguments for creating a spirit asset
   * 
   * Ensures that all required fields for creating a spirit asset are present
   * and validates their formats using Joi schema validation. This validates both
   * the presence and type of each field and ensures values are within acceptable ranges.
   * 
   * @param {Object} args - Arguments to validate
   * @param {Object} args.itemArgs - Spirit creation arguments
   * @param {string} args.itemArgs.name - Name of the spirit
   * @param {string} args.itemArgs.description - Description of the spirit
   * @param {number} args.itemArgs.quantity - Quantity of spirit to create (must be positive)
   * @param {number} args.itemArgs.decimals - Number of decimal places (0-18)
   * @param {string} args.itemArgs.spiritType - Type of spirit (e.g., whiskey, vodka, rum)
   * @param {number} args.itemArgs.unitOfMeasurement - Unit of measurement (0-8 representing different units)
   * @param {string[]} args.itemArgs.images - Array of image URLs (can contain null values)
   * @param {string[]} args.itemArgs.files - Array of file URLs (can contain null values)
   * @param {string[]} args.itemArgs.fileNames - Array of file names (can contain null values)
   * @param {string} args.itemArgs.redemptionService - Service used for redemption
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateCreateSpiritsArgs(args) {
    const createSpiritsSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
        spiritType: Joi.string().required(),
        unitOfMeasurement: Joi.number().integer().min(0).max(8).required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createSpiritsSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Spirits Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default SpiritsController;
