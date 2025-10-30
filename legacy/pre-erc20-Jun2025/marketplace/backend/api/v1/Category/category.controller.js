import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import CategoriesJson from '../../../category-utility/categories.json';

class CategoryController {
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

  static async getAll(req, res, next) {
    try {
      rest.response.status200(res, CategoriesJson.categories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

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
