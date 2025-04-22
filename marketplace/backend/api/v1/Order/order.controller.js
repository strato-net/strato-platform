/**
 * @fileoverview Order Controller
 * 
 * This module handles the business logic for order management in the marketplace,
 * including retrieving orders, processing payments, managing shipping addresses,
 * and order lifecycle events.
 * 
 * @module api/v1/Order/OrderController
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';
import constants from '../../../helpers/constants';
const options = { config, cacheNonce: true };

class OrderController {
  /**
   * Retrieves a specific order by its blockchain address
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the order to retrieve
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns the order details or passes error to next middleware
   */
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

  /**
   * Retrieves a list of all sale orders with optional pagination
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of orders to return
   * @param {number} [req.query.offset] - Number of orders to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns orders list with total count or passes error to next middleware
   */
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

  /**
   * Processes a payment for an order and sends email confirmation if successful
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {Object} req.body.paymentService - Payment service details
   * @param {string} req.body.paymentService.address - Blockchain address of payment service
   * @param {string} req.body.paymentService.serviceName - Name of payment service
   * @param {string} req.body.buyerOrganization - Organization of the buyer
   * @param {Array} req.body.orderList - List of items being ordered
   * @param {number} req.body.orderTotal - Total amount of the order
   * @param {number} req.body.tax - Tax amount for the order
   * @param {string} req.body.user - User email or identifier for notifications
   * @param {Array} req.body.htmlContents - HTML content for email confirmation
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns payment result or passes error to next middleware
   */
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

  /**
   * Waits for an order event to occur and returns the event details
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.orderHash - Hash of the order to wait for events
   * @param {string} [req.query.reserve] - Reserve address for the order
   * @param {string} [req.query.asset] - Asset address for the order
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns order event or passes error to next middleware
   */
  static async waitForOrderEvent(req, res, next) {
    try {
      const { dapp, query } = req;
      const { orderHash, reserve, asset } = query;
      const orderEvent = await dapp.waitForOrderEvent(
        { orderHash, reserve, asset },
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

  /**
   * Exports all orders in a format suitable for external systems
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns exported orders or passes error to next middleware
   */
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

  /**
   * Creates a new shipping address for a user
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.name - Name associated with shipping address
   * @param {string} req.body.zipcode - ZIP/Postal code
   * @param {string} req.body.state - State or province
   * @param {string} req.body.city - City
   * @param {string} req.body.addressLine1 - First line of the address
   * @param {string} [req.body.addressLine2] - Second line of the address (optional)
   * @param {string} req.body.country - Country
   * @param {string} [req.body.redemptionService] - Redemption service identifier (optional)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns the created user address or passes error to next middleware
   */
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

  /**
   * Retrieves a specific shipping address by ID and redemption service
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {Object} req.params - Path parameters
   * @param {string} req.params.redemptionService - Identifier for the redemption service
   * @param {string} req.params.shippingAddressId - ID of the shipping address to retrieve
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns user address or passes error to next middleware
   */
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

  /**
   * Retrieves all shipping addresses for a user filtered by redemption service
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {Object} req.params - Path parameters
   * @param {string} req.params.redemptionService - Identifier for the redemption service
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of user addresses or passes error to next middleware
   */
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

  /**
   * Cancels an existing sale order
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.saleOrderAddress - Blockchain address of the sale order to cancel
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns cancellation result or passes error to next middleware
   */
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

  /**
   * Completes an order by marking it as fulfilled
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.orderAddress - Blockchain address of the order to execute
   * @param {number} req.body.fulfillmentDate - Unix timestamp for the fulfillment date
   * @param {string} [req.body.comments] - Optional comments about the fulfillment
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns execution result or passes error to next middleware
   */
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

  /**
   * Updates the comment on an existing order
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.saleOrderAddress - Blockchain address of the order to update
   * @param {string} req.body.comments - New comment for the order
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns update result or passes error to next middleware
   */
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

  /**
   * Checks the available quantity for a sale
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.assetAddress - Blockchain address of the asset to check
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns sale quantity or passes error to next middleware
   */
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

  /**
   * Validates payment arguments
   * 
   * @param {Object} args - Payment arguments to validate
   * @param {Object} args.paymentService - Payment service details
   * @param {string} args.paymentService.address - Blockchain address of payment service
   * @param {string} args.paymentService.serviceName - Name of payment service
   * @param {string} args.buyerOrganization - Organization of the buyer
   * @param {Array} args.orderList - List of items being ordered
   * @param {number} args.orderTotal - Total amount of the order
   * @param {number} args.tax - Tax amount for the order
   * @param {string} args.user - User email or identifier for notifications
   * @throws {RestError} - If validation fails
   */
  static validatePaymentArgs(args) {
    const paymentSchema = Joi.object({
      paymentService: Joi.object({
        address: Joi.string().required(),
        serviceName: Joi.string().required(),
      }).required(),
      buyerOrganization: Joi.string().allow('').required(),
      orderList: Joi.array()
        .min(1)
        .items(
          Joi.object({
            quantity: Joi.string().pattern(/^\d+$/).required(),
            decimals: Joi.number().integer().min(0).max(18).required(),
            assetAddress: Joi.string().required(),
            firstSale: Joi.boolean().required(),
            unitPrice: Joi.string().pattern(/^\d+(\.\d+)?$/).required(),
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

  /**
   * Validates create user address arguments
   * 
   * @param {Object} args - User address arguments to validate
   * @param {string} args.name - Name associated with shipping address
   * @param {string} args.zipcode - ZIP/Postal code
   * @param {string} args.state - State or province
   * @param {string} args.city - City
   * @param {string} args.addressLine1 - First line of the address
   * @param {string} [args.addressLine2] - Second line of the address (optional)
   * @param {string} args.country - Country
   * @param {string} [args.redemptionService] - Redemption service identifier (optional)
   * @throws {RestError} - If validation fails
   */
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

  /**
   * Validates update order comment arguments
   * 
   * @param {Object} args - Order comment arguments to validate
   * @param {string} args.saleOrderAddress - Blockchain address of the order to update
   * @param {string} args.comments - New comment for the order
   * @throws {RestError} - If validation fails
   */
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

  /**
   * Validates execute sale arguments
   * 
   * @param {Object} args - Execute sale arguments to validate
   * @param {string} args.orderAddress - Blockchain address of the order to execute
   * @param {number} args.fulfillmentDate - Unix timestamp for the fulfillment date
   * @param {string} [args.comments] - Optional comments about the fulfillment
   * @throws {RestError} - If validation fails
   */
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
