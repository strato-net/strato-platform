import Joi from "@hapi/joi";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  createPool,
  addLiquidity,
  removeLiquidity,
  swap,
} from "../services/pools.service";

class PoolsController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;

      PoolsController.validateAddressArgs(params);

      const token = await getPools(accessToken, {
        address: "eq." + params.address,
      });
      res.status(RestStatus.OK).json(token);
    } catch (error) {
      next(error);
    }
  }

  static async getAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;

      PoolsController.validateQueryArgs(query);

      const tokens = await getPools(
        accessToken,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      PoolsController.validateCreatePoolsArgs(body);

      const result = await createPool(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async addLiquidity(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      PoolsController.validateAddLiquidityArgs(body);

      const result = await addLiquidity(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async removeLiquidity(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { accessToken, body } = req;

      PoolsController.validateRemoveLiquidityArgs(body);

      const result = await removeLiquidity(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async swap(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      PoolsController.validateSwapArgs(body);

      const result = await swap(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------
  static validateAddressArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error("Address Argument Validation Error");
    }
  }

  static validateQueryArgs(args: any) {
    const schema = Joi.object({
      limit: Joi.string().optional(),
      offset: Joi.string().optional(),
      address: Joi.string().optional(),
      owner: Joi.string().optional(),
      creator: Joi.string().optional(),
      order: Joi.string().optional(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error("Query Argument Validation Error");
    }
  }

  static validateCreatePoolsArgs(args: any) {
    const schema = Joi.object({
      token: Joi.string().required(),
      stablecoin: Joi.string().required(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error(
        "Create Pool Argument Validation Error: " + validation.error.message
      );
    }
  }

  static validateAddLiquidityArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
      stable_amount: Joi.string().required(),
      max_tokens: Joi.string().required(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error(
        "Add Liduitity Argument Validation Error: " + validation.error.message
      );
    }
  }

  static validateRemoveLiquidityArgs(args: any) {
    const schema = Joi.object({
      address: Joi.string().required(),
      amount: Joi.string().required(),
      min_stable: Joi.string().required(),
      min_tokens: Joi.string().required(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error(
        "Remove Liduitity Argument Validation Error: " +
          validation.error.message
      );
    }
  }

  static validateSwapArgs(args: any) {
    const schema = Joi.object({
      method: Joi.string().valid("stableToToken", "tokenToStable").required(),
      amount: Joi.string().required(),
      min_tokens: Joi.string().required(),
    });

    const validation = schema.validate(args);

    if (validation.error) {
      throw new Error(
        "Swap Argument Validation Error: " + validation.error.message
      );
    }
  }
}

export default PoolsController;
