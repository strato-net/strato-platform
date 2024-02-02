import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class AssetGroupController {

  //   static async get(req, res, next) {
  //     try {
  //       const { dapp, params } = req
  //       const { address } = params

  //       let args
  //       let chainOptions = options

  //       if (address) {
  //         args = { address }
  //         chainOptions = { ...options }
  //       }

  //       const assetGroup = await dapp.getAssetGroup(args, chainOptions)
  //       rest.response.status200(res, assetGroup)

  //       return next()
  //     } catch (e) {
  //       return next(e)
  //     }
  //   }

  //   static async getAll(req, res, next) {
  //     try {
  //       const { dapp, query } = req

  //       const assetGroups = await dapp.getAssetGroups({ ...query })
  //       const assetGroupsWithImageUrl = assetGroups?.assetGroups
  //       rest.response.status200(res, {assetGroupsWithImageUrl:assetGroupsWithImageUrl, count: assetGroups.inventoryCount})

  //       return next()
  //     } catch (e) {
  //       return next(e)
  //     }
  //   }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req
      AssetGroupController.validateCreateAssetGroupArgs(body)

      const result = await dapp.createAssetGroup(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateAssetGroupArgs(args) {
    const createAssetGroupSchema = Joi.object({
      assets: Joi.array().min(2).items(Joi.object({
        assetAddress: Joi.string().required(),
        assetQuantity: Joi.number().integer().greater(0).required()
      })).required(),
      groupName: Joi.string().required(),
      description: Joi.string().required(),
      groupPrice: Joi.number().integer().greater(0).required(),
      images: Joi.array().items(Joi.string().allow(null)).required(),
      files: Joi.array().items(Joi.string().allow(null)).required(),
    });


    const validation = createAssetGroupSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error)
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Asset Group Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default AssetGroupController
