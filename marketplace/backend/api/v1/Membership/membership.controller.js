import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class MembershipController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address, chainId } = params 
     
      let args
      let chainOptions = options
      
      if (address) {
        args = { address }
        if (chainId) {
          chainOptions = { ...options, chainIds: [chainId] }
        }
      }

      const result = await dapp.getMembership(args, chainOptions)
      const temp = result.productFiles?.map(async (productFile) => {
        const productFileImageUrl = await getSignedUrlFromS3(productFile.fileLocation, req.app.get(constants.s3ParamName))
        return { ...productFile, imageUrl: productFileImageUrl }
      }) || []
      const out = { membership : result.membership, membershipServices: result.membershipServices, productFiles: temp }

      rest.response.status200(res, out)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      
      const memberships = await dapp.getMemberships({ ...query })
      rest.response.status200(res, memberships)
     
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      MembershipController.validateCreateMembershipArgs(body)
    
      const result = await dapp.createMembership(body)
      rest.response.status200(res, result)
      
      return next()
    } catch (e) {
      return next(e)
    }
  }
        
  static validateCreateMembershipArgs(args) {
    const createMembershipSchema = Joi.object({
        membershipArgs: Joi.object({
            name: Joi.string().required(),
            description: Joi.string().required(),
            manufacturer: Joi.string().required(),
            unitOfMeasurement: Joi.number().required(),
            userUniqueMembershipCode: Joi.string().required(),
            uniqueMembershipCode: Joi.number().required(),
            leastSellableUnit: Joi.number().required(),
            imageKey: Joi.string().required(),
            isActive: Joi.boolean().required(),
            category: Joi.string().required(),
            subCategory: Joi.string().required(),
            createdDate: Joi.number().required(),
            timePeriodInMonths: Joi.number().required(),
            additionalInfo: Joi.string().required(),
        }).required(),
        membershipServiceArgs: Joi.array().items(Joi.object({
            serviceId: Joi.string().required(),
            membershipPrice: Joi.number().required(),
            discountPrice: Joi.number().required(),
            maxQuantity: Joi.number().required(),
            createdDate: Joi.number().required(),
            isActive: Joi.boolean().required(),
        })).required(),
        productFileArgs: Joi.array().items(Joi.object({
            fileLocation: Joi.string().required(),
            fileHash: Joi.string().required(),
            fileName: Joi.string().required(),
            uploadDate: Joi.number().required(),
            createdDate: Joi.number().required(),
            section: Joi.number().required(),
            type: Joi.number().required(),
        })).required(),
    });

    const validation = createMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Membership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default MembershipController
