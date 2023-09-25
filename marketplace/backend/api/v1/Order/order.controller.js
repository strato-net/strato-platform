import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'
const options = { config, cacheNonce: true }

class OrderController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
      }

      const order = await dapp.getOrder(args, chainOptions)
      const orderLinesWithImageUrl = order.orderLines.map(orderLine => ({
        ...orderLine,
        imageUrl: getSignedUrlFromS3(orderLine.imageKey, req.app.get(constants.s3ParamName))
      }))
      const result = { ...order, orderLines: orderLinesWithImageUrl }
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const orders = await dapp.getOrders({ ...query })
      rest.response.status200(res, orders)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateCreateOrderArgs(body)

      const result = await dapp.createOrder(body)
      rest.response.status200(res, result)

      console.log("*Buyer placed order*");

      return next()
    } catch (e) {
      return next(e)
    }
  }



  static async updateBuyerDetails(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateUpdateBuyerArgs(body)

      const result = await dapp.updateBuyerDetails(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }


  static async updateSellerDetails(req, res, next) {
    try {
      const { dapp, body } = req

      OrderController.validateUpdateSellerArgs(body)

      const result = await dapp.updateSellerDetails(body, options)

      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async payment(req, res, next) {
    try {
      const { dapp, body, accessToken } = req
      OrderController.validatePaymentArgs(body)

      const result = await dapp.paymentCheckout(body, options, accessToken)
      rest.response.status200(res, result)
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

  static async paymentSession(req, res, next) {
    try {
      const { dapp, params } = req

      OrderController.validatePaymentSessionArgs(params)

      const result = await dapp.getPaymentSession({ session_id: params.session_id })
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


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateOrderArgs(args) {
    const createOrderSchema = Joi.object({
      buyerOrganization: Joi.string().required(),
      orderList: Joi.array().min(1).items(Joi.object({
        inventoryId: Joi.string().required(),
        quantity: Joi.number().required()
      })).required(),
      orderTotal: Joi.number().required(),
      paymentSessionId: Joi.string(),
      shippingAddress: Joi.string().required(),
    }).required();

    const validation = createOrderSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Order Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validatePaymentArgs(args) {
    const paymentSchema = Joi.object({
      buyerOrganization: Joi.string().required(),
      orderList: Joi.array().min(1).items(Joi.object({
            inventoryId: Joi.string().required(),
            quantity: Joi.number().required()
          })).required(),
      orderTotal: Joi.number().required(),
      shippingAddress: Joi.string().required()
    }).required();

    const validation = paymentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Payment Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validatePaymentSessionArgs(args) {
    const paymentSchema = Joi.object({
      session_id: Joi.string().required()
    }).required();

    const validation = paymentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Payment session Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateBuyerArgs(args) {
    const updateBuyerSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().required(),
        buyerComments: Joi.string().required(),
      }),
    });

    const validation = updateBuyerSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Buyer Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateUpdateSellerArgs(args) {
    const updateSellerSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().required(),
        sellerComments: Joi.string().allow(''),
        fullfilmentDate: Joi.number()
      }),
    });

    const validation = updateSellerSchema.validate(args);
    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Update Seller Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateCreateUserAddressArgs(args) {
    const createUserAddressSchema = Joi.object({
      shippingName: Joi.string().required(),
      shippingZipcode: Joi.string().required(),
      shippingState: Joi.string().required(),
      shippingCity: Joi.string().required(),
      shippingAddressLine1: Joi.string().required(),
      shippingAddressLine2: Joi.string().allow(""),
      billingName: Joi.string().required(),
      billingZipcode: Joi.string().required(),
      billingState: Joi.string().required(),
      billingCity: Joi.string().required(),
      billingAddressLine1: Joi.string().required(),
      billingAddressLine2: Joi.string().allow("")
    }).required();

    const validation = createUserAddressSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create User Address Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default OrderController
