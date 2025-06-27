import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  createPool,
  addLiquidity,
  removeLiquidity,
  swap,
  calculateSwap,
  calculateSwapReverse,
} from "../services/swapping.service";
import { getBalance } from "../services/tokens.service";
import {
  validateAddressArgs,
  validateCreatePoolsArgs,
  validateAddLiquidityArgs,
  validateRemoveLiquidityArgs,
  validateSwapArgs,
  validateQueryParams,
  validateCalculateSwapArgs,
} from "../validators/swapping.validator";

class SwappingController {
  // Getters
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, address } = req;
      validateAddressArgs(params);

      const token = await getPools(accessToken, address, {
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
      const { accessToken, query, address } = req;
      validateQueryParams(query);

      const tokens = await getPools(
        accessToken,
        address,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  // Creators
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body } = req;
      validateCreatePoolsArgs(body);

      const result = await createPool(accessToken, body);
      res.status(200).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // Liquidity
  static async addLiquidity(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body } = req;
    validateAddLiquidityArgs(body);

    const result = await addLiquidity(accessToken, body.poolAddress, body.tokenBAmount, body.maxTokenAAmount);
    res.status(200).json(result);
    return next();
  }

  static async removeLiquidity(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body } = req;
    validateRemoveLiquidityArgs(body);

    const result = await removeLiquidity(accessToken, body.poolAddress, body.lpTokenAmount);
    res.status(200).json(result);
    return next();
  }

  // Swaps
  static async swap(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body } = req;
    validateSwapArgs(body);

    const result = await swap(accessToken, body.poolAddress, body.isAToB, body.amountIn, body.minAmountOut);
    res.status(200).json(result);
    return next();
  }

  // Calculators
  static async calculateSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { accessToken, query } = req;
    validateCalculateSwapArgs(query);
    const { poolAddress, isAToB, amountIn, reserve } = query;
    const isReserve = reserve === "true";

    if (isReserve) {
      const price = await calculateSwapReverse(
        accessToken,
        poolAddress as string,
        isAToB === "true",
        amountIn as string
      );
      res.status(RestStatus.OK).json(price);
    } else {
      const price = await calculateSwap(
        accessToken,
        poolAddress as string,
        isAToB === "true",
        amountIn as string
      );
      res.status(RestStatus.OK).json(price);
    }
  }

  // Helpers
  static async getLPTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;

      const userTokens = await getBalance(accessToken, address);
      const userTokensAddresses = userTokens.map((token: any) => token.address);
      const pools = await getPools(accessToken, address, {
        lpToken: "in.(" + userTokensAddresses.join(",") + ")",
      });

      res.status(RestStatus.OK).json(pools);
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
      const { accessToken, address } = req;
      const pools = await getPools(accessToken, address);

      const tokenMap = new Map();
      
      pools.forEach((pool: any) => {
        [pool.tokenA, pool.tokenB].forEach((token: any) => {
          if (!tokenMap.has(token.address)) {
            tokenMap.set(token.address, token);
          }
        });
      });

      const uniqueTokens = Array.from(tokenMap.values());

      res.status(RestStatus.OK).json(uniqueTokens);
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
      const { accessToken, params, address } = req;
      validateAddressArgs(params);

      const poolA = await getPools(accessToken, address, {
        tokenA: "eq." + params.address,
      });

      const poolB = await getPools(accessToken, address, {
        tokenB: "eq." + params.address,
      });

      const tokens = [
        ...poolA.map((pool: any) => pool.tokenB),
        ...poolB.map((pool: any) => pool.tokenA),
      ].filter(Boolean);

      const tokenMap = new Map();
      tokens.forEach((token: any) => {
        if (!tokenMap.has(token.address)) {
          tokenMap.set(token.address, token);
        }
      });

      const uniqueTokenPairs = Array.from(tokenMap.values());

      res.status(RestStatus.OK).json(uniqueTokenPairs);
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
      validateQueryParams(query);

      const pools = await getPools(accessToken, undefined, {
        tokenA: "in.(" + query.tokenPair + ")",
        tokenB: "in.(" + query.tokenPair + ")",
      });
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }
}

export default SwappingController;
