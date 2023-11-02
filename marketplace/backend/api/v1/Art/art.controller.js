import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class ArtController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const arts = await dapp.getArts({ ...query })
      rest.response.status200(res, arts)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      ArtController.validateCreateArtArgs(body)

      const result = await dapp.createArt(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // static async update(req, res, next) {
  //   try {
  //     const { dapp, body } = req

  //     ArtController.validateUpdateArtArgs(body)

  //     const result = await dapp.updateArt(body, options)

  //     rest.response.status200(res, result)
  //     return next()
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // static async transferOwnership(req, res, next) {
  //   try {
  //     const { dapp, body } = req

  //     ArtController.validateTransferOwnershipArgs(body)
  //     const result = await dapp.transferOwnershipArt(body, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateArtArgs(args) {
    const createArtSchema = Joi.object({
      artArgs: Joi.object({
        serialNumber: Joi.string().required(),
        status: Joi.number().integer().min(1).max(4).required(),
        comment: Joi.string().required(),
        itemNumber: Joi.number().integer().min(0).required(), // Assuming uint is a non-negative integer
        createdDate: Joi.number().integer().min(0).required(), // Assuming uint represents a timestamp
        owner: Joi.string().alphanum().length(42).required(), // Ethereum addresses are 42 characters long, including the '0x'
        name: Joi.string().required(),
        desc: Joi.string().required(),
        artQuantity: Joi.number().integer().min(0).required(),
        images: Joi.array().items(Joi.string().uri()).required(), // Assuming images are URLs; adjust if they are stored differently
        price: Joi.number().positive().required(), // Assuming price cannot be negative
        saleState: Joi.number().integer().valid(0, 1, 2, ...).required(), // Replace with actual enum values
        paymentType: Joi.number().integer().valid(0, 1, 2, ...).required(), // Replace with actual enum values
      }).required()
    });

    const validation = createArtSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Art Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

//   static validateUpdateArtArgs(args) {
//     const updateArtSchema = Joi.object({
//       artAddress: Joi.string().required(),
//       updates: Joi.object({
//         status: Joi.number().integer().min(1).max(4),
//         comment: Joi.string()
//       }).required()
//     });

//     const validation = updateArtSchema.validate(args);

//     if (validation.error) {
//       throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Art Argument Validation Error', {
//         message: `Missing args or bad format: ${validation.error.message}`,
//       })
//     }
//   }

//   static validateTransferOwnershipArgs(args) {
//     const transferOwnershipArtSchema = Joi.object({
//       address: Joi.string().required(),
//       chainId: Joi.string().required(),
//       newOwner: Joi.string().required()
//     })

//     const validation = transferOwnershipArtSchema.validate(args);

//     if (validation.error) {
//       throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Art Argument Validation Error', {
//         message: `Missing args or bad format: ${validation.error.message}`,
//       })
//     }
//   }
// }

export default ArtController
