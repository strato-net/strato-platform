import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import CategoriesJson from '../../../category-utility/categories.json';

/**
 * @class CategoryController
 * @description Controller for handling Category-related API endpoints
 */
class CategoryController {
  /**
   * @method get
   * @description Retrieves a specific category by its blockchain address
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request path parameters
   * @param {string} req.params.address - Blockchain address of the category
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns category details
   * @throws {Error} - Forwards any errors to the error handler
   */
  static async get(req, res, next) {
    try {
      const { params } = req;
      const { address } = params;

      let result;
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method getAll
   * @description Retrieves a list of all categories in the system
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of categories
   * @throws {Error} - Forwards any errors to the error handler
   */
  static async getAll(req, res, next) {
    try {
      rest.response.status200(res, CategoriesJson.categories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * @method validateCreateCategoryArgs
   * @description Validates the arguments for creating a category
   * @param {Object} args - Arguments to validate
   * @param {string} args.name - Name of the category
   * @param {string} args.description - Description of the category
   * @param {string} args.imageKey - Image key for the category
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
  static validateCreateCategoryArgs(args) {
    const createCategorySchema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
      imageKey: Joi.string().required(),
    });

    const validation = createCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Category Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * @method validateUpdateCategoryArgs
   * @description Validates the arguments for updating a category
   * @param {Object} args - Arguments to validate
   * @param {string} args.address - Blockchain address of the category to update
   * @param {Object} args.updates - Category updates
   * @param {string} [args.updates.name] - Updated name of the category
   * @param {string} [args.updates.description] - Updated description of the category
   * @param {string} [args.updates.imageKey] - Updated image key for the category
   * @throws {rest.RestError} - Throws BAD_REQUEST error if validation fails
   */
  static validateUpdateCategoryArgs(args) {
    const updateCategorySchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        name: Joi.string(),
        description: Joi.string(),
        imageKey: Joi.string(),
      }).required(),
    });

    const validation = updateCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Category Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default CategoryController;
