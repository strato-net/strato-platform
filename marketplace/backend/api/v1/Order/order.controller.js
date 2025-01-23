import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';
import constants from '../../../helpers/constants';
const options = { config, cacheNonce: true };

class OrderController {
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address } = params;

      let args;
      let chainOptions = options;

      if (address) {
        args = { address };
      }

      const order = await dapp.getOrder(args, chainOptions);

      const assetsWithImageUrl = order.assets;
      const result = { ...order, assets: assetsWithImageUrl };
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { orders, total } = await dapp.getSaleOrders({ ...query });

      rest.response.status200(res, { orders, total });
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async payment(req, res, next) {
    try {
      const { dapp, body } = req;
      const { htmlContents, ...restArgs } = body;
      OrderController.validatePaymentArgs(restArgs);

      const result = await dapp.paymentCheckout(
        restArgs,
        options
      );
      const [checkoutHash, assets] = result;
      rest.response.status200(res, result);
      // check orderEvent.status is 3 and sendEmail
      // Only send email if order is created successfully(USDST Orders)
      const orderEvent = await dapp.getUSDSTOrderEvent(
        {
          orderHash: checkoutHash,
          paymentService: restArgs.paymentService.address,
        },
        options
      );
      if (
        orderEvent &&
        orderEvent.length === 1 &&
        orderEvent[0].status === '3' &&
        orderEvent[0].currency === 'USDST'
      ) {
        await sendEmail(body.user, 'Your Order Confirmation', htmlContents[0]);
        console.log('*Buyer placed order*', orderEvent);
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async waitForOrderEvent(req, res, next) {
    try {
      const { dapp, query } = req;
      const { orderHash } = query;
      const orderEvent = await dapp.waitForOrderEvent(
        { orderHash: orderHash },
        options
      );
      if (orderEvent && orderEvent.length === 1) {
        rest.response.status200(res, orderEvent);
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async export(req, res, next) {
    try {
      const { dapp } = req;
      const orders = await dapp.export();
      rest.response.status200(res, orders);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async createUserAddress(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderController.validateCreateUserAddressArgs(body);

      const result = await dapp.createUserAddress(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getUserAddress(req, res, next) {
    try {
      const { dapp, query } = req;
      const { redemptionService, shippingAddressId } = req.params;

      const orders = await dapp.getUserAddress({
        ...query,
        redemptionService,
        shippingAddressId,
      });
      rest.response.status200(res, orders);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllUserAddress(req, res, next) {
    try {
      const { dapp, query } = req;
      const { redemptionService } = req.params;

      const orders = await dapp.getAllUserAddress({
        ...query,
        redemptionService,
      });
      rest.response.status200(res, orders);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async cancelSaleOrder(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderController.validateCancelSaleOrderArgs(body);

      const result = await dapp.cancelSaleOrder(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async executeSale(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderController.validateExecuteSaleArgs(body);

      const result = await dapp.completeOrder(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async updateOrderComment(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderController.validateUpdateOrderCommentArgs(body);

      const result = await dapp.updateOrderComment(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async checkSaleQuantity(req, res, next) {
    try {
      const { dapp, body } = req;
      const saleQuantity = await dapp.checkSaleQuantity(body);
      rest.response.status200(res, saleQuantity);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validatePaymentArgs(args) {
    const paymentSchema = Joi.object({
      paymentService: Joi.object({
        address: Joi.string().required(),
        serviceName: Joi.string().required(),
      }).required(),
      buyerOrganization: Joi.string().required(),
      orderList: Joi.array()
        .min(1)
        .items(
          Joi.object({
            quantity: Joi.string().pattern(/^\d+$/).required(),
            assetAddress: Joi.string().required(),
            firstSale: Joi.boolean().required(),
            unitPrice: Joi.number().greater(0).precision(30).required(),
          })
        )
        .required(),
      orderTotal: Joi.number().required(),
      tax: Joi.number().required(),
      user: Joi.string().required(),
    }).required();

    const validation = paymentSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Payment Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateCreateUserAddressArgs(args) {
    const createUserAddressSchema = Joi.object({
      name: Joi.string().required(),
      zipcode: Joi.string().required(),
      state: Joi.string().required(),
      city: Joi.string().required(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().allow(''),
      country: Joi.string().required(),
      redemptionService: Joi.string().optional(),
    }).required();

    const validation = createUserAddressSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create User Address Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateOrderCommentArgs(args) {
    const updateOrderCommentSchema = Joi.object({
      saleOrderAddress: Joi.string().required(),
      comments: Joi.string().required(),
    }).required();

    const validation = updateOrderCommentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Order Comment Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateExecuteSaleArgs(args) {
    const executeSaleSchema = Joi.object({
      orderAddress: Joi.string().required(),
      fulfillmentDate: Joi.number().required(),
      comments: Joi.string().allow(''),
    }).required();

    const validation = executeSaleSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Execute Sale Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default OrderController;
