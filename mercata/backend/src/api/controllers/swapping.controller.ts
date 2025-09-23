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
      const { accessToken, params, address: userAddress } = req;
      validatePoolAddressArgs(params);

      const pools = await getPools(accessToken, userAddress, {
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
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const tokens = await getPools(
        accessToken,
        userAddress,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  // Creators
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateCreatePoolsArgs(body);

      const result = await createPool(accessToken, body, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Liquidity
  static async addLiquidityDualToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateAddLiquidityDualTokenArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const liquidityParams = {
        ...body,
        poolAddress: params.poolAddress,
        deadline
      };

      const result = await addLiquidityDualToken(accessToken, liquidityParams, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async addLiquiditySingleToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateAddLiquiditySingleTokenArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const liquidityParams = {
        ...body,
        poolAddress: params.poolAddress,
        deadline
      };

      const result = await addLiquiditySingleToken(accessToken, liquidityParams, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removeLiquidity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateRemoveLiquidityArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const removeLiquidityParams = {
        ...body,
        poolAddress: params.poolAddress,
        deadline
      };

      const result = await removeLiquidity(accessToken, removeLiquidityParams, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Swaps
  static async swap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateSwapArgs(body);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const result = await swap(accessToken, { ...body, deadline }, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Helpers
  static async getUserLiquidityPools(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;

      const userTokens = await getBalance(accessToken, userAddress, {select: "address", value: "gt.0"});
      const userTokensAddresses = userTokens.map((token: any) => token.address);
      const pools = await getPools(accessToken, userAddress, {
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
      const { accessToken, address: userAddress } = req;
      const tokens = await getSwapableTokens(accessToken, userAddress);

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
      const { accessToken, params, address: userAddress } = req;
      validateTokenAddressArgs(params);

      const tokens = await getSwapableTokenPairs(accessToken, params.tokenAddress, userAddress);

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
      const { accessToken, params, address: userAddress } = req;
      validateTokenPairArgs(params);

      const pools = await getPools(accessToken, userAddress, {
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

      const page = query.page ? parseInt(query.page as string, 10) : 1;
      const limit = query.limit ? parseInt(query.limit as string, 10) : 10;
      const swapHistory = await getSwapHistory(accessToken, params.poolAddress, page, limit);
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
      const { accessToken, body, address: userAddress } = req;
      validateSetPoolRatesArgs(body);

      const result = await setPoolRates(accessToken, body, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default SwappingController;
