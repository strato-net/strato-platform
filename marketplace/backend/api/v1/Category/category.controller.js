import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class CategoryController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
      }
  
      chainOptions = { ...options }

      const category = await dapp.getCategory(args, chainOptions)
      const categoryImageUrl=getSignedUrlFromS3(category.imageKey, req.app.get(constants.s3ParamName))
      const result={...category,imageUrl:categoryImageUrl}
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const categories = await dapp.getCategories({ ...query })
      const categoriesWithImageUrl=categories.map(category=>({
        ...category,
        imageUrl:getSignedUrlFromS3(category.imageKey,req.app.get(constants.s3ParamName))
      }))
      rest.response.status200(res, categoriesWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      CategoryController.validateCreateCategoryArgs(body)
 
      const result = await dapp.createCategory(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      CategoryController.validateUpdateCategoryArgs(body)

      const result = await dapp.updateCategory(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  // TODO - remove it post developement
  // static async audit(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address, chainId } = params

  //     const result = await dapp.auditCategory( { address, chainId }, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }




  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateCategoryArgs(args) {
    const createCategorySchema = Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        imageKey:Joi.string().required()
    });

    const validation = createCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Category Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateCategoryArgs(args) {
    const updateCategorySchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        name: Joi.string(),
        description: Joi.string(),
        imageKey:Joi.string()
      }).required(),
    });

    const validation = updateCategorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Category Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }


}

export default CategoryController
