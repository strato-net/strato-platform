import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  getSwapableTokens,
  getSwapableTokenPairs,
  createPool,
  addLiquidityDualToken,
  addLiquiditySingleToken,
  removeLiquidity,
  swap,
  getSwapHistory,
  setPoolRates,
} from "../services/swapping.service";
import { getBalance } from "../services/tokens.service";
import {
  validatePoolAddressArgs,
  validateTokenAddressArgs,
  validateTokenPairArgs,
  validateCreatePoolsArgs,
  validateAddLiquidityDualTokenArgs,
  validateAddLiquiditySingleTokenArgs,
  validateRemoveLiquidityArgs,
  validateSwapArgs,
  validateQueryParams,
  validateSwapHistoryArgs,
  validateSetPoolRatesArgs,
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
      validatePoolAddressArgs(params);

      const pools = await getPools(accessToken, address, {
        address: "eq." + params.poolAddress,
      });

      if (!pools || pools.length === 0) {
        throw new Error("Pool not found");
      }

      res.status(RestStatus.OK).json(pools[0]);
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
  static async addLiquidityDualToken(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body, params } = req;
    validateAddLiquidityDualTokenArgs(body);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const liquidityParams = {
      ...body,
      poolAddress: params.poolAddress,
      deadline
    };

    const result = await addLiquidityDualToken(accessToken, liquidityParams);
    res.status(200).json(result);
    return next();
  }

  static async addLiquiditySingleToken(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body, params } = req;
    validateAddLiquiditySingleTokenArgs(body);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const liquidityParams = {
      ...body,
      poolAddress: params.poolAddress,
      deadline
    };

    const result = await addLiquiditySingleToken(accessToken, liquidityParams);
    res.status(200).json(result);
    return next();
  }

  static async removeLiquidity(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body, params } = req;
    validateRemoveLiquidityArgs(body);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const removeLiquidityParams = {
      ...body,
      poolAddress: params.poolAddress,
      deadline
    };

    const result = await removeLiquidity(accessToken, removeLiquidityParams);
    res.status(200).json(result);
    return next();
  }

  // Swaps
  static async swap(req: Request, res: Response, next: NextFunction) {
    const { accessToken, body } = req;
    validateSwapArgs(body);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
    const result = await swap(accessToken, { ...body, deadline });
    res.status(200).json(result);
    return next();
  }

  // Helpers
  static async getUserLiquidityPools(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;

      const userTokens = await getBalance(accessToken, address, {select: "address", value: "gt.0"});
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
      const tokens = await getSwapableTokens(accessToken, address);

      res.status(RestStatus.OK).json(tokens);
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
      validateTokenAddressArgs(params);

      const tokens = await getSwapableTokenPairs(accessToken, params.tokenAddress, address);

      res.status(RestStatus.OK).json(tokens);
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
      const { accessToken, params, address } = req;
      validateTokenPairArgs(params);

      const pools = await getPools(accessToken, address, {
        tokenA: "in.(" + params.tokenAddress1 + "," + params.tokenAddress2 + ")",
        tokenB: "in.(" + params.tokenAddress1 + "," + params.tokenAddress2 + ")",
      });
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async getSwapHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateSwapHistoryArgs(params);
      validateQueryParams(query);

      const swapHistory = await getSwapHistory(accessToken, params.poolAddress, query as Record<string, string | undefined>);
      res.status(RestStatus.OK).json(swapHistory);
    } catch (error) {
      next(error);
    }
  }

  // Admin operations
  static async setPoolRates(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSetPoolRatesArgs(body);

      const result = await setPoolRates(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default SwappingController;
