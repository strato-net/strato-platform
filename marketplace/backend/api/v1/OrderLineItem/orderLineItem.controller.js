import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";
import config from "../../../load.config";

const options = { config, cacheNonce: true };

class OrderLineItemController {
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address, chainId } = params;

      let args;
      let chainOptions = options;

      if (address) {
        args = { address };
        if (chainId) {
          chainOptions = { ...options, chainIds: [chainId] };
        }
      }

      const result = await dapp.getOrderLineItem(args, chainOptions);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const orderLineItems = await dapp.getOrderLineItems({ ...query });
      rest.response.status200(res, orderLineItems);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderLineItemController.validateCreateOrderLineItemArgs(body);

      const result = await dapp.createOrderLineItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderLineItemController.validateUpdateOrderLineItemArgs(body);

      const result = await dapp.updateOrderLineItem(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async audit(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address, chainId } = params;

      const result = await dapp.auditOrderLineItem(
        { address, chainId },
        options
      );
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req;

      OrderLineItemController.validateTransferOwnershipArgs(body);
      const result = await dapp.transferOwnershipOrderLineItem(body, options);
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateOrderLineItemArgs(args) {
    const createOrderLineItemSchema = Joi.object({
      orderId: Joi.string().required(),
      orderLineId: Joi.string().required(),
      serialNumber: Joi.array().items().optional(),
      chainId: Joi.string().required(),
    });

    const validation = createOrderLineItemSchema.validate(args);
    // console.log(validation);
    // process.exit();
    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Create OrderLineItem Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateOrderLineItemArgs(args) {
    const updateOrderLineItemSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      updates: Joi.object({
        orderId: Joi.string(),
        inventoryId: Joi.string(),
        productId: Joi.string(),
        quantity: Joi.number(),
        pricePerUnit: Joi.number(),
        createdAt: Joi.string(),
      }).required(),
    });

    const validation = updateOrderLineItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Update OrderLineItem Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipOrderLineItemSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    });

    const validation = transferOwnershipOrderLineItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Transfer Ownership OrderLineItem Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default OrderLineItemController;
