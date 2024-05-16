import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import sendEmail from '../../../helpers/email'
import constants from '../../../helpers/constants'
const options = { config, cacheNonce: true }

class OrderController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args;
      let chainOptions = options;

      if (address) {
        args = { address }
      }

      const order = await dapp.getOrder(args, chainOptions);
      const assetsWithImageUrl = order.assets
      const result = { ...order, assets: assetsWithImageUrl }
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const orders = await dapp.getSaleOrders({ ...query })
      rest.response.status200(res, orders)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async payment(req, res, next) {
    try {
      const { dapp, body, accessToken } = req
      const originUrl = req.headers.origin || config.serverHost;
      OrderController.validatePaymentArgs(body)

      const result = await dapp.paymentCheckout(originUrl, body, options, accessToken)
      rest.response.status200(res, result)
    } catch (e) {
      return next(e)
    }
  }
  
  static async export(req, res, next) {
    try {
      const { dapp } = req
      const orders = await dapp.export()
      rest.response.status200(res, orders)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async createUserAddress(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateCreateUserAddressArgs(body)

      const result = await dapp.createUserAddress(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllUserAddress(req, res, next) {
    try {
      const { dapp, query } = req

      const orders = await dapp.getAllUserAddress({ ...query })
      rest.response.status200(res, orders)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async cancelSaleOrder(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateCancelSaleOrderArgs(body)

      const result = await dapp.cancelSaleOrder(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async executeSale(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateExecuteSaleArgs(body)

      const result = await dapp.completeOrder(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async updateOrderComment(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateUpdateOrderCommentArgs(body)

      const result = await dapp.updateOrderComment(body)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async checkSaleQuantity(req, res, next) {
    try {
      const { dapp, body} = req;
      const saleQuantity = await dapp.checkSaleQuantity(body)
      rest.response.status200(res, saleQuantity)

      return next()
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------

  static validatePaymentArgs(args) {
    const paymentSchema = Joi.object({
      paymentProvider: Joi.object({
        address: Joi.string().required(),
      }).required(),
      buyerOrganization: Joi.string().required(),
      orderList: Joi.array().min(1).items(Joi.object({
        quantity: Joi.number().required(),
        assetAddress: Joi.string().required(),
        firstSale: Joi.boolean().required(),
        unitPrice: Joi.number().required()
      })).required(),
      orderTotal: Joi.number().required(),
      tax: Joi.number().required(),
      user: Joi.string().required(),
      email: Joi.string().required(),
    }).required();

    const validation = paymentSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Payment Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateCreateUserAddressArgs(args) {
    const createUserAddressSchema = Joi.object({
      name: Joi.string().required(),
      zipcode: Joi.string().required(),
      state: Joi.string().required(),
      city: Joi.string().required(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().allow(""),
      country: Joi.string().required(),
      redemptionService: Joi.string().required(),
    }).required();

    const validation = createUserAddressSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create User Address Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateCancelSaleOrderArgs(args) {
    const cancelSaleOrderSchema = Joi.object({
      saleOrderAddress: Joi.string().required(),
      comments: Joi.string().allow(""),
    }).required();

    const validation = cancelSaleOrderSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Cancel Sale Order Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateOrderCommentArgs(args) {
    const updateOrderCommentSchema = Joi.object({
      saleOrderAddress: Joi.string().required(),
      comments: Joi.string().required(),
    }).required();

    const validation = updateOrderCommentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Order Comment Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateExecuteSaleArgs(args) {
    const executeSaleSchema = Joi.object({
      orderAddress: Joi.string().required(),
      fulfillmentDate: Joi.number().required(),
      comments: Joi.string().allow(""),
    }).required();

    const validation = executeSaleSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Execute Sale Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default OrderController
