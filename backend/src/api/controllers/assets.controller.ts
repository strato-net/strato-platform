import Joi from '@hapi/joi';
import { Request, Response, NextFunction } from 'express';
import RestStatus from 'http-status-codes';


class AssetsController {
  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { address } = req.params;

      // const inventory = await dapp.getAsset({ address });
      // res.status(200).json(inventory);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { ...restQuery } = req.query;

      // const inventories = await dapp.getAssets({ ...restQuery });
      // res.status(200).json(inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { body } = req;
      AssetsController.validateCreateInventoryArgs(body);

      // const result = await dapp.createInventory(body);
      // res.status(200).json({
      //   message: 'Inventory created successfully',
      //   inventory: result,
      // });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { body } = req;
      AssetsController.validateTransferItemArgs(body);

      // const result = await dapp.transferItem(body);
      // res.status(200).json({
      //   message: 'Transfer successful',
      //   result,
      // });
      return next();
    } catch (e) {
      return next(e);
    }
  }
  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateInventoryArgs(args: any) {
    const createInventorySchema = Joi.object({
      quantity: Joi.number().integer().min(0).required(),
      decimals: Joi.number().integer().min(0).max(18).required()
    });

    const validation = createInventorySchema.validate(args);

    if (validation.error) {
      throw new Error(
        'Create Inventory Argument Validation Error'
      );
    }
  }

  static validateTransferItemArgs(args: any) {
    const transferItemSchema = Joi.array()
      .min(1)
      .items(
        Joi.object({
          assetAddress: Joi.string().required(),
          newOwner: Joi.string().required(),
          quantity: Joi.string().pattern(/^\d+$/).required(),
        })
      );

    const validation = transferItemSchema.validate(args);

    if (validation.error) {
      throw new Error(
        'Transfer Item Argument Validation Error'
      );
    }
  }
}

export default AssetsController;
