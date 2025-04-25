import Joi from "@hapi/joi";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  createPool,
  addLiquidity,
  removeLiquidity,
  swap,
  getStableToTokenInputPrice,
  getStableToTokenOutputPrice,
  getTokenToStableInputPrice,
  getTokenToStableOutputPrice,
  getCurrentTokenPrice,
  getCurrentStablePrice,
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

  static async getStableToTokenInputPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, params } = req;
      PoolsController.validatePriceQueryArgs(query, "stable_sold");
      const stableSold = BigInt(query.stable_sold as string);
      const price = await getStableToTokenInputPrice(accessToken, {
        stable_sold: stableSold,
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price: price.toString() });
    } catch (error) {
      next(error);
    }
  }

  static async getStableToTokenOutputPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, params } = req;
      PoolsController.validatePriceQueryArgs(query, "tokens_bought");
      const tokensBought = BigInt(query.tokens_bought as string);
      const price = await getStableToTokenOutputPrice(accessToken, {
        tokens_bought: tokensBought,
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price: price.toString() });
    } catch (error) {
      next(error);
    }
  }

  static async getTokenToStableInputPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, params } = req;
      PoolsController.validatePriceQueryArgs(query, "tokens_sold");
      const tokensSold = BigInt(query.tokens_sold as string);
      const price = await getTokenToStableInputPrice(accessToken, {
        tokens_sold: tokensSold,
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price: price.toString() });
    } catch (error) {
      next(error);
    }
  }

  static async getTokenToStableOutputPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, params } = req;
      PoolsController.validatePriceQueryArgs(query, "stable_bought");
      const stableBought = BigInt(query.stable_bought as string);
      const price = await getTokenToStableOutputPrice(accessToken, {
        stable_bought: stableBought,
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price: price.toString() });
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentTokenPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;
      const price = await getCurrentTokenPrice(accessToken, {
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price });
    } catch (error) {
      next(error);
    }
  }

  static async getCurrentStablePrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;
      const price = await getCurrentStablePrice(accessToken, {
        address: params.address as string,
      });
      res.status(RestStatus.OK).json({ price: price.toString() });
    } catch (error) {
      next(error);
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
      address: Joi.string().required(),
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

  static validatePriceQueryArgs(args: any, field: string) {
    const schema = Joi.object({
      [field]: Joi.string()
        .pattern(/^[0-9]+$/)
        .required(),
    });
    const { error } = schema.validate(args);
    if (error) {
      throw new Error(`Invalid query parameter: ${field}`);
    }
  }
}

export default PoolsController;
