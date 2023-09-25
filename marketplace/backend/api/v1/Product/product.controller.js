import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class ProductController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
        chainOptions = { ...options }
      }

      const product = await dapp.getProduct(args, chainOptions)
      const productImageUrl = getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
      const result = { ...product, imageUrl: productImageUrl }
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const products = await dapp.getProducts({ ...query })
      const productsWithImageUrl = products.map(product => (
        product.imageKey ?
        {
          ...product,
          imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
        }
        :
        product
      ))
      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllProductNames(req, res, next) {
    try {
      const { dapp, query } = req

      const products = await dapp.getProductNames({ ...query })
      rest.response.status200(res, products)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      ProductController.validateCreateProductArgs(body)

      const result = await dapp.createProduct(body)
      rest.response.status200(res, result)

      console.log("*Seller added product*");

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req

      ProductController.validateUpdateProductArgs(body)

      // If the old image key is present, delete the old image from S3. Keys are sent from UpdateProductModal.js
      const result = await dapp.updateProduct(body, options)

      if (req.body.updates.oldImageKey) {

        const fileKey = req.body.updates.oldImageKey

        const isDeleted = await deleteFileFromS3(fileKey, req.app.get(constants.s3ParamName))
        if (!isDeleted) {
          rest.response.status400(res, "Image is failed to delete")
        }
      }

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async delete(req, res, next) {
    try {
      const { dapp, body } = req

      ProductController.validateDeleteProductArgs(body)

      const result = await dapp.deleteProduct(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  // static async audit(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address, chainId } = params

  //     const result = await dapp.auditProduct({ address, chainId }, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // static async transferOwnership(req, res, next) {
  //   try {
  //     const { dapp, body } = req

  //     ProductController.validateTransferOwnershipArgs(body)
  //     const result = await dapp.transferOwnershipProduct(body, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateProductArgs(args) {
    const createProductSchema = Joi.object({
      productArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        manufacturer: Joi.string().required(),
        unitOfMeasurement: Joi.number().integer().min(1).max(10).required(),
        userUniqueProductCode: Joi.string().allow("").required(),
        leastSellableUnit: Joi.number().required(),
        imageKey: Joi.string().required(),
        isActive: Joi.boolean().required(),
        category: Joi.string().required(),
        subCategory: Joi.string().required()
      })
    });

    const validation = createProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Product Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateProductArgs(args) {
    const updateProductSchema = Joi.object({
      productAddress: Joi.string().required(),
      updates: Joi.object({
        description: Joi.string(),
        imageKey: Joi.string(),
        isActive: Joi.boolean(),
        userUniqueProductCode: Joi.string().allow(""),
        oldImageKey: Joi.string().optional()
      }).required()
    });

    const validation = updateProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Product Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateDeleteProductArgs(args) {
    const deleteProductSchema = Joi.object({
      productAddress: Joi.string().required()
    });

    const validation = deleteProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Delete Product Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipProductSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required()
    })

    const validation = transferOwnershipProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Transfer Ownership Product Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}

export default ProductController
