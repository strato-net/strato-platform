import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import sendEmail from '../../../helpers/email'
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

  static async create(req, res, next) {
    try {
      const { dapp, body } = req
      
      const { to, subject, htmlContents } = body;

      OrderController.validateCreateOrderArgs(body)

      const result = await dapp.createOrder(body)
      
      rest.response.status200(res, result)

      // Only send email if order is created successfully
      if (res.statusMessage === "OK") {
        //for every item in htmlContents, send email
        for (let i = 0; i < htmlContents.length; i++) {
          await sendEmail(to, subject, htmlContents[i]);
        }
      }

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

      const result = await dapp.getPaymentSession(params)
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

  static async getAddressFromId(req, res, next) {
    try {
      const { dapp, params } = req

      const orders = await dapp.getAddressFromId(params)
      rest.response.status200(res, orders)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async createSaleOrder(req, res, next) {
    try {
      const { dapp, body } = req

      const { to, subject, htmlContents, ...restBody } = body;

      OrderController.validateCreateSaleOrderArgs(restBody)

      const result = await dapp.createSaleOrder(restBody)
      rest.response.status200(res, result)

      // Only send email if order is created successfully
      if (res.statusMessage === "OK") {
        //for every item in htmlContents, send email
        for (let i = 0; i < htmlContents.length; i++) {
          await sendEmail(to, subject, htmlContents[i]);
        }
      }

      console.log("*Buyer placed order*");

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


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateOrderArgs(args) {
    const createOrderSchema = Joi.object({
      buyerOrganization: Joi.string().required(),
      orderList: Joi.array().min(1).items(Joi.object({
        inventoryId: Joi.string().required(),
        quantity: Joi.number().required(),
        subCategory: Joi.string().required(),
      })).required(),
      orderTotal: Joi.number().required(),
      paymentSessionId: Joi.string(),
      shippingAddress: Joi.string().required(),
      to: Joi.string().required(),
      subject: Joi.string().required(),
      htmlContents: Joi.array().min(1).required(),
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
            quantity: Joi.number().required(),
            assetAddress: Joi.string().required(),
          })).required(),
      orderTotal: Joi.number().required(),
      shippingAddressId: Joi.number().min(1).required(),
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

  static validatePaymentSessionArgs(args) {
    const paymentSchema = Joi.object({
      session_id: Joi.string().required(),
      sellersCommonName: Joi.string().required(),
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
      name: Joi.string().required(),
      zipcode: Joi.string().required(),
      state: Joi.string().required(),
      city: Joi.string().required(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().allow(""),
      country: Joi.string().required(),
    }).required();

    const validation = createUserAddressSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create User Address Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

  static validateCreateSaleOrderArgs(args) {
    const createSaleOrderSchema = Joi.object({
      items: Joi.array().min(1).items(Joi.object({
        quantity: Joi.number().required(),
        saleAddress: Joi.string().required(),
      })).required(),
      shippingAddressId: Joi.number().min(1).required(),
      paymentSessionId: Joi.string().required(),
    }).required();

    const validation = createSaleOrderSchema.validate(args);

    if (validation.error) {
      console.log(validation.error);
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Sale Order Argument Validation Error', {
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
