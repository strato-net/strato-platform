import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class SubCategoryController {

  static async get(req, res, next) {
    try {
      const { address } = params
      
      let result;
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      
      let result;
      rest.response.status200(res, result)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { body } = req

      SubCategoryController.validateCreateSubCategoryArgs(body)
    
      let result;
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { body } = req

      SubCategoryController.validateUpdateSubCategoryArgs(body)

      let result;
      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }



  // ----------------------- ARG VALIDATION ------------------------
  
  static validateCreateSubCategoryArgs(args) {
    const createSubCategorySchema = Joi.object({
      categoryAddress: Joi.string().required(),
      name: Joi.string().required(),
      description: Joi.string().required()
    })

    const validation = createSubCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create subCategory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateSubCategoryArgs(args) {
    const updateSubCategorySchema = Joi.object({
      categoryAddress: Joi.string().required(),
      subCategoryAddress: Joi.string(),
      updates: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required()
      }).required()
    });

    const validation = updateSubCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update subCategory Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

 
}

export default SubCategoryController
