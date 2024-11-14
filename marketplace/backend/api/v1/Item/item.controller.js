import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class ItemController {
  //unused route
  // static async get(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address } = params

  //     let args
  //     let chainOptions = options

  //     if (address) {
  //       args = { address }
  //       chainOptions = { ...options, chainIds: [dapp.chainId] }
  //     }

  //     const result = await dapp.getItem(args, chainOptions)
  //     rest.response.status200(res, result)

  //     return next()
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const items = await dapp.getItems({ ...query });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getOwnershipHistory(req, res, next) {
    try {
      const { dapp, params } = req;
      console.log('#### I am coming here for some reason?');
      ItemController.validateGetItemOwnershipHistoryArgs(params);
      const { address } = params;

      const items = await dapp.getItemOwnershipHistory({
        itemAddress: address,
      });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllItemTransferEvents(req, res, next) {
    try {
      const { dapp, query } = req;

      const itemTransfers = await dapp.getAllItemTransferEvents(query);

      rest.response.status200(res, itemTransfers);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateCreateItemArgs(body);

      const result = await dapp.addItem(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateUpdateItemArgs(body);

      const result = await dapp.updateItem(body, options);

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

      const result = await dapp.auditItem({ address, chainId }, options);
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  static async transferOwnership(req, res, next) {
    try {
      const { dapp, body } = req;

      ItemController.validateTransferOwnershipArgs(body);
      const result = await dapp.transferOwnershipItem(body, options);
      rest.response.status200(res, result);
    } catch (e) {
      return next(e);
    }
  }

  static async getAllRawMaterials(req, res, next) {
    try {
      const { dapp, query } = req;

      const items = await dapp.getRawMaterials({ ...query });
      rest.response.status200(res, items);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateItemArgs(args) {
    const createItemSchema = Joi.object({
      itemArgs: Joi.object({
        productId: Joi.string().required(),
        inventoryId: Joi.string().required(),
        serialNumber: Joi.string().required(),
        status: Joi.number().integer().min(1).max(4).required(),
        comment: Joi.string().required(),
      }),
    });

    const validation = createItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateGetItemOwnershipHistoryArgs(args) {
    const getItemOwnershipHistorySchema = Joi.object({
      address: Joi.string().required(),
    });

    const validation = getItemOwnershipHistorySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Get Item Ownership History Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateItemArgs(args) {
    const updateItemSchema = Joi.object({
      itemAddress: Joi.string().required(),
      updates: Joi.object({
        status: Joi.number().integer().min(1).max(4),
        comment: Joi.string(),
      }).required(),
    });

    const validation = updateItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateTransferOwnershipArgs(args) {
    const transferOwnershipItemSchema = Joi.object({
      inventoryId: Joi.string().required(),
      itemsAddress: Joi.array().items(Joi.string()).required(),
      newOwner: Joi.string().required(),
      newQuantity: Joi.number().integer().min(1).required(),
    });

    const validation = transferOwnershipItemSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Transfer Ownership Item Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ItemController;
