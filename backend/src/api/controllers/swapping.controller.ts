import Joi from "@hapi/joi";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  createPool,
  addLiquidity,
  removeLiquidity,
  swap,
  calculateSwap,
} from "../services/swapping.service";
import { getBalance, getTokens } from "../services/tokens.service";

class SwappingController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;

      SwappingController.validateAddressArgs(params);

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

      SwappingController.validateCreatePoolsArgs(body);

      const result = await createPool(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getLPTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken,address } = req;

      const userTokens = await getBalance(accessToken, {
        key: "eq." + address,
      });
      const userTokensAddresses = userTokens.map((token: any) => token.address);
      const pools = await getPools(accessToken, {
        address: "in.(" + userTokensAddresses.join(",") + ")",
      });

      const poolsWithUserTokens = pools.map((pool: any) => {
        const userToken = userTokens.find(
          (token: any) => token.address === pool.address
        );
        return {
          ...pool,
          ...userToken,
        };
      });
      res.status(RestStatus.OK).json(poolsWithUserTokens);
    } catch (error) {
      next(error);
    }
  }

  static async addLiquidity(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;

      SwappingController.validateAddLiquidityArgs(body);

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

      SwappingController.validateRemoveLiquidityArgs(body);

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

      SwappingController.validateSwapArgs(body);

      const result = await swap(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async calculateSwap(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;

      const price = await calculateSwap(
        accessToken,
        query.address as string,
        query.direction as string,
        query.amount as string
      );
      res.status(RestStatus.OK).json(price);
    } catch (error) {
      next(error);
    }
  }

  static async getSwapableTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const pools = await getPools(accessToken, {
        select: "data->>tokenA,data->>tokenB",
      });

      const uniqueTokens = [
        ...new Set(
          pools
            .flatMap((pool: any) => [pool.tokenA, pool.tokenB])
            .filter(Boolean)
        ),
      ];

      const tokenDetails = await getTokens(accessToken, {
        address: "in.(" + uniqueTokens.join(",") + ")",
        select: "address,_name,_symbol",
      });

      res.status(RestStatus.OK).json(tokenDetails);
    } catch (error) {
      next(error);
    }
  }

  static async getSwapableTokenPairs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params } = req;

      SwappingController.validateAddressArgs({ address: params.address });

      const poolA = await getPools(accessToken, {
        "data->>tokenA": "eq." + params.address,
        select: "token:data->>tokenB",
      });

      const poolB = await getPools(accessToken, {
        "data->>tokenB": "eq." + params.address,
        select: "token:data->>tokenA",
      });

      const uniqueTokenPairs = [
        ...new Set(
          [
            ...poolA.map((pool: any) => pool.token),
            ...poolB.map((pool: any) => pool.token),
          ].filter(Boolean)
        ),
      ];

      const tokenDetails = await getTokens(accessToken, {
        address: "in.(" + uniqueTokenPairs.join(",") + ")",
        select: "address,_name,_symbol",
      });

      res.status(RestStatus.OK).json(tokenDetails);
    } catch (error) {
      next(error);
    }
  }

  static async getPoolByTokenPair(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;

      const pools = await getPools(accessToken, {
        "data->>tokenA": "in.(" + query.tokenPair + ")",
        "data->>tokenB": "in.(" + query.tokenPair + ")",
      });
      res.status(RestStatus.OK).json(pools);
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
      tokenB_amount: Joi.string().required(),
      max_tokenA_amount: Joi.string().required(),
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
      // min_tokenB: Joi.string().required(),
      // min_tokenA_amount: Joi.string().required(),
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
      method: Joi.string().valid("tokenAToTokenB", "tokenBToTokenA").required(),
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

export default SwappingController;
