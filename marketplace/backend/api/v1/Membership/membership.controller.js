import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

/**
 * Controller for handling Membership-related API endpoints.
 * Provides functionality for retrieving all memberships and creating new memberships.
 * Memberships represent time-limited access to a service or product.
 */
class MembershipController {
  /**
   * Retrieves a list of all memberships in the system.
   * Can be filtered by query parameters.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.query - Query parameters for filtering memberships
   * @param {number} [req.query.limit] - Maximum number of memberships to return
   * @param {number} [req.query.offset] - Number of memberships to skip
   * @param {string} [req.query.owner] - Filter memberships by owner address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with array of membership objects, each containing:
   *   - address: Blockchain address of the membership
   *   - serialNumber: Optional serial number of the membership
   *   - name: Name of the membership
   *   - description: Description of the membership
   *   - expirationPeriodInMonths: Duration of the membership in months
   *   - quantity: Quantity of membership tokens
   *   - decimals: Number of decimal places for the membership token
   *   - images: Array of image URLs for the membership
   *   - files: Array of file URLs for the membership
   *   - fileNames: Array of file names for the membership
   *   - redemptionService: Service used for redeeming the membership
   *   - owner: Current owner of the membership
   *   - createdAt: Creation timestamp of the membership
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const memberships = await dapp.getMemberships({ ...query });
      rest.response.status200(res, memberships);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new membership in the system.
   * Validates input arguments using Joi schema.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body containing membership details
   * @param {Object} req.body.itemArgs - Membership parameters
   * @param {string} [req.body.itemArgs.serialNumber] - Optional serial number for the membership
   * @param {string} req.body.itemArgs.name - Name of the membership
   * @param {string} req.body.itemArgs.description - Detailed description of the membership
   * @param {number} req.body.itemArgs.expirationPeriodInMonths - Duration of the membership in months (minimum: 1)
   * @param {number} req.body.itemArgs.quantity - Quantity of membership tokens to create (minimum: 1)
   * @param {number} req.body.itemArgs.decimals - Number of decimal places for the membership token (0-18)
   * @param {Array<string|null>} req.body.itemArgs.images - Array of image URLs for the membership
   * @param {Array<string|null>} req.body.itemArgs.files - Array of file URLs for the membership
   * @param {Array<string|null>} req.body.itemArgs.fileNames - Array of file names for the membership
   * @param {string} req.body.itemArgs.redemptionService - Service used for redeeming the membership
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   *   with object containing membership details:
   *   - address: Blockchain address of the created membership
   *   - name: Name of the membership
   *   - description: Description of the membership
   *   - expirationPeriodInMonths: Duration of the membership in months
   *   - quantity: Quantity of membership tokens
   *   - decimals: Number of decimal places
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

      MembershipController.validateCreateMembershipArgs(body);

      const result = await dapp.createMembership(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates the arguments for creating a membership.
   * Uses Joi schema validation to ensure all required fields are present and correctly formatted.
   * 
   * @param {Object} args - Arguments for creating a membership
   * @param {Object} args.itemArgs - Membership parameters
   * @param {string} [args.itemArgs.serialNumber] - Optional serial number for the membership
   * @param {string} args.itemArgs.name - Name of the membership (required)
   * @param {string} args.itemArgs.description - Description of the membership (required)
   * @param {number} args.itemArgs.expirationPeriodInMonths - Duration in months (required, min: 1)
   * @param {number} args.itemArgs.quantity - Quantity of tokens (required, min: 1)
   * @param {number} args.itemArgs.decimals - Decimal places (required, min: 0, max: 18)
   * @param {Array<string|null>} args.itemArgs.images - Array of image URLs (required)
   * @param {Array<string|null>} args.itemArgs.files - Array of file URLs (required)
   * @param {Array<string|null>} args.itemArgs.fileNames - Array of file names (required)
   * @param {string} args.itemArgs.redemptionService - Redemption service (required)
   * @throws {RestError} - Throws a RestError with BAD_REQUEST status if validation fails
   * @private
   */
  static validateCreateMembershipArgs(args) {
    const createMembershipSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow('').optional(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        expirationPeriodInMonths: Joi.number().integer().min(1).required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createMembershipSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Membership Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default MembershipController;
