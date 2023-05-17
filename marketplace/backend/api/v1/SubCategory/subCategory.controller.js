import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class SubCategoryController {

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

      const result = await dapp.getSubCategory(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const subCategorys = await dapp.getSubCategories({ ...query })
      rest.response.status200(res, subCategorys)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      SubCategoryController.validateCreateSubCategoryArgs(body)
    
      const result = await dapp.createSubCategory(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      SubCategoryController.validateUpdateSubCategoryArgs(body)

      const result = await dapp.updateSubCategory(body, options)

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

  //     const result = await dapp.auditSubCategory( { address, chainId }, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }




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
