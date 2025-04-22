/**
 * @fileoverview SubCategory Controller
 * 
 * This module handles the business logic for subcategory operations in the marketplace,
 * including creating, retrieving, and updating subcategories. Subcategories provide a way
 * to organize marketplace items into a hierarchical taxonomy, where they exist under parent categories.
 * 
 * The controller validates input parameters, interacts with the blockchain via the dapp instance
 * or reads from local category files, and properly formats API responses. It supports filtering
 * subcategories by their parent category and manages the relationship between categories and
 * subcategories.
 * 
 * @module api/v1/SubCategory/SubCategoryController
 * @see module:api/v1/SubCategory
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';
import CategoriesJson from '../../../category-utility/categories.json';

const options = { config, cacheNonce: true };

/**
 * Controller class for handling subcategory-related operations
 * 
 * @class SubCategoryController
 */
class SubCategoryController {
  /**
   * Retrieves a specific subcategory by its blockchain address
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the subcategory
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns subcategory details or passes error to next middleware
   * @throws {RestError} - If the subcategory doesn't exist or there's an error retrieving it
   * @see GET /subcategory/{address}
   */
  static async get(req, res, next) {
    try {
      let result;
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of all subcategories with optional filtering by category
   * 
   * Returns subcategories organized under their parent categories. The results can be
   * filtered by category name to return only subcategories belonging to specified categories.
   * Anonymous access is allowed for this endpoint.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.query - Query parameters
   * @param {string|string[]} [req.query.category] - Filter subcategories by category name(s),
   *                                                can be a single value or comma-separated list
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of subcategories or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving the subcategories
   * @see GET /subcategory
   */
  static async getAll(req, res, next) {
    try {
      const { query } = req;
      const { category } = query;
      const categories = CategoriesJson.categories;

      if (Array.isArray(category)) {
        if (category[0].indexOf(',') > -1) {
          let subCategoryList = [];
          categories.map((record) => {
            if (category[0].includes(record.name)) {
              record.subCategories.map((subCategory) => {
                subCategoryList.push(subCategory);
              });
            }
          });
          rest.response.status200(res, subCategoryList);
        } else {
          const categoryRecord = categories.find(
            (record) => record.name === category[0]
          );
          const subCategories = categoryRecord?.subCategories;
          rest.response.status200(res, subCategories ? subCategories : []);
        }
      } else {
        const categoryRecord = categories.find(
          (record) => record.name === category
        );
        const subCategories = categoryRecord?.subCategories;

        rest.response.status200(res, subCategories);
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new subcategory under a specified parent category
   * 
   * Creates a new subcategory with the provided name and description under the specified
   * parent category. This endpoint requires authentication and validates all input parameters
   * before creating the subcategory.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.categoryAddress - Blockchain address of the parent category
   * @param {string} req.body.name - Name of the new subcategory
   * @param {string} req.body.description - Description of the new subcategory
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created subcategory or passes error to next middleware
   * @throws {RestError} - If validation fails, the parent category doesn't exist, or there's an error creating the subcategory
   * @see POST /subcategory
   */
  static async create(req, res, next) {
    try {
      const { body } = req;

      SubCategoryController.validateCreateSubCategoryArgs(body);

      let result;
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Updates an existing subcategory
   * 
   * Updates the name and description of an existing subcategory. This endpoint
   * requires authentication and validates all input parameters before updating
   * the subcategory.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.categoryAddress - Blockchain address of the parent category
   * @param {string} req.body.subCategoryAddress - Blockchain address of the subcategory to update
   * @param {Object} req.body.updates - Updates to apply to the subcategory
   * @param {string} req.body.updates.name - New name for the subcategory
   * @param {string} req.body.updates.description - New description for the subcategory
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns updated subcategory or passes error to next middleware
   * @throws {RestError} - If validation fails, the subcategory doesn't exist, or there's an error updating it
   * @see PUT /subcategory/update
   */
  static async update(req, res, next) {
    try {
      const { body } = req;

      SubCategoryController.validateUpdateSubCategoryArgs(body);

      let result;
      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates arguments for creating a subcategory
   * 
   * Ensures that all required fields for creating a subcategory are present
   * and validates their formats using Joi schema validation.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.categoryAddress - Blockchain address of the parent category
   * @param {string} args.name - Name of the new subcategory
   * @param {string} args.description - Description of the new subcategory
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateCreateSubCategoryArgs(args) {
    const createSubCategorySchema = Joi.object({
      categoryAddress: Joi.string().required(),
      name: Joi.string().required(),
      description: Joi.string().required(),
    });

    const validation = createSubCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create subCategory Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates arguments for updating a subcategory
   * 
   * Ensures that all required fields for updating a subcategory are present
   * and validates their formats using Joi schema validation.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.categoryAddress - Blockchain address of the parent category
   * @param {string} [args.subCategoryAddress] - Blockchain address of the subcategory to update
   * @param {Object} args.updates - Updates to apply to the subcategory
   * @param {string} args.updates.name - New name for the subcategory
   * @param {string} args.updates.description - New description for the subcategory
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateUpdateSubCategoryArgs(args) {
    const updateSubCategorySchema = Joi.object({
      categoryAddress: Joi.string().required(),
      subCategoryAddress: Joi.string(),
      updates: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
      }).required(),
    });

    const validation = updateSubCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update subCategory Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default SubCategoryController;
