import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class MembershipController {

//  static async get(req, res, next) {
//    try {
//      const { dapp, params } = req
//      const { address, chainId } = params 
//     
//      let args
//      let chainOptions = options
//      
//      if (address) {
//        args = { address }
//        if (chainId) {
//          chainOptions = { ...options, chainIds: [chainId] }
//        }
//      }
//
//      const result = await dapp.getMembership(args, chainOptions)
//      rest.response.status200(res, result)
//
//      return next()
//    } catch (e) {
//      return next(e)
//    }
//  }

//  static async getAll(req, res, next) {
//    try {
//      const { dapp, query } = req
//      
//      const memberships = await dapp.getMemberships({ ...query })
//      rest.response.status200(res, memberships)
//     
//      return next()
//    } catch (e) {
//      return next(e)
//    }
//  }

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

//  static async update(req, res, next) {
//    try {
//      const { dapp, body } = req
//
//      MembershipController.validateUpdateMembershipArgs(body)
//
//      const result = await dapp.updateMembership(body, options)
//
//      rest.response.status200(res, result)
//      return next()
//    } catch (e) {
//      return next(e)
//    }
//  }
//
//  static async transferOwnership(req, res, next) {
//    try {
//      const { dapp, body } = req
//
//      MembershipController.validateTransferOwnershipArgs(body)
//      const result = await dapp.transferOwnershipMembership(body, options)
//      rest.response.status200(res, result)
//    } catch (e) {
//      return next(e)
//    }
//  }


  // ----------------------- ARG VALIDATION ------------------------
  
  //createMembership:
  //  type: object
  //  properties:
  //    dappAddress:
  //      type: string
  //    membershipArgs:
  //      type: object
  //      properties:
  //        name:
  //          type: string
  //        description:
  //          type: string
  //        manufacturer:
  //          type: string
  //        unitOfMeasurement:
  //          type: number
  //        userUniqueMembershipCode:
  //          type: string
  //        uniqueMembershipCode:
  //          type: number
  //        leastSellableUnit:
  //          type: number
  //        imageKey:
  //          type: string
  //        isActive:
  //          type: boolean
  //        category:
  //          type: string
  //        subCategory:
  //          type: string
  //        createdDate:
  //          type: number
  //        timePeriodInMonths:
  //          type: number
  //        additionalInfo:
  //          type: string
  //    mebershipServiceArgs:
  //      type: array
  //      items:
  //        type: object
  //        properties:
  //          serviceId:
  //            type: string
  //          membershipPrice:
  //            type: number
  //          discountPrice:
  //            type: number
  //          maxQuantity:
  //            type: number
  //          createdDate:
  //            type: number
  //          isActive:
  //            type: boolean
  //    productFileArgs:
  //      type: array
  //      items:
  //        type: object
  //        properties:
  //          fileLocation:
  //            type: string
  //          fileHash:
  //            type: string
  //          fileName:
  //            type: string
  //          uploadDate:
  //            type: number
  //          createdDate:
  //            type: number
  //          section:
  //            type: string
  //          type:
  //            type: string
   
        
  static validateCreateMembershipArgs(args) {
    const createMembershipSchema = Joi.object({
        dappAddress: Joi.string().required(),
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
            section: Joi.string().required(),
            type: Joi.string().required(),
        })).required(),
    });

    const validation = createMembershipSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Membership Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  //static validateUpdateMembershipArgs(args) {
  //  const updateMembershipSchema = Joi.object({
  //    address: Joi.string().required(),
  //    updates: Joi.object({
  //      productId: Joi.string(),
  //      timePeriodInMonths: Joi.number(),
  //      additionalInfo: Joi.string(),
  //      createdDate: Joi.number(),
  //    }).required(),
  //  });

  //  const validation = updateMembershipSchema.validate(args);

  //  if (validation.error) {
  //    throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Membership Argument Validation Error', {
  //      message: `Missing args or bad format: ${validation.error.message}`,
  //    })
  //  }
  //}

  //static validateTransferOwnershipArgs(args) {
  //  const transferOwnershipMembershipSchema = Joi.object({
  //    address: Joi.string().required(),
  //    newOwner: Joi.string().required(),
  //  })

  //  const validation = transferOwnershipMembershipSchema.validate(args);

  //  if (validation.error) {
  //    throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Membership Argument Validation Error', {
  //      message: `Missing args or bad format: ${validation.error.message}`,
  //    })
  //  }
  //}
}

export default MembershipController
