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
  pausePool,
  unpausePool,
  disablePool,
  enablePool,
  exchangeMultiToken,
  addLiquidityMultiToken,
  removeLiquidityMultiToken,
  removeLiquidityMultiTokenOneCoin,
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
  validateTogglePauseArgs,
  validateToggleDisableArgs,
  validateMultiTokenSwapArgs,
  validateMultiTokenAddLiquidityArgs,
  validateMultiTokenRemoveLiquidityArgs,
  validateMultiTokenRemoveLiquidityOneArgs,
} from "../validators/swapping.validator";
import { validateAddressField } from "../validators/common.validators";

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

      const pool = pools.find(p => p.address.toLowerCase() === params.poolAddress.toLowerCase());

      if (!pool) {
        throw new Error("Pool not found");
      }

      res.status(RestStatus.OK).json(pool);
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

      const addr1 = params.tokenAddress1.toLowerCase();
      const addr2 = params.tokenAddress2.toLowerCase();

      const pools = await getPools(accessToken, userAddress, {
        tokenA: "in.(" + params.tokenAddress1 + "," + params.tokenAddress2 + ")",
        tokenB: "in.(" + params.tokenAddress1 + "," + params.tokenAddress2 + ")",
      });

      // Filter to only pools where both requested tokens have pool balance > 0
      const filteredPools = pools.filter(pool => {
        // Multi-token pool: check coins array
        if (pool.coins && pool.coins.length > 2) {
          const coin1 = pool.coins.find((c: any) => c.address.toLowerCase() === addr1);
          const coin2 = pool.coins.find((c: any) => c.address.toLowerCase() === addr2);
          return coin1 && coin2
            && BigInt(coin1.poolBalance || "0") > 0n
            && BigInt(coin2.poolBalance || "0") > 0n;
        }
        // 2-token pool: check tokenA and tokenB
        const tokenAAddr = pool.tokenA?.address?.toLowerCase();
        const tokenBAddr = pool.tokenB?.address?.toLowerCase();
        const hasToken1 = tokenAAddr === addr1 || tokenBAddr === addr1;
        const hasToken2 = tokenAAddr === addr2 || tokenBAddr === addr2;
        if (!hasToken1 || !hasToken2) return false;
        return BigInt(pool.tokenA?.poolBalance || "0") > 0n
            && BigInt(pool.tokenB?.poolBalance || "0") > 0n;
      });

      res.status(RestStatus.OK).json(filteredPools);
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
      const sender = query.sender as string | undefined;
      if (sender) {
        const { error } = validateAddressField("sender").validate(sender);
        if (error) throw new Error("sender Validation Error: " + error.message);
      }
      const swapHistory = await getSwapHistory(accessToken, params.poolAddress, page, limit, sender);
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

  static async togglePause(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateTogglePauseArgs(body);

      const result = body.isPaused
        ? await pausePool(accessToken, body.poolAddress, userAddress as string)
        : await unpausePool(accessToken, body.poolAddress, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async toggleDisable(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateToggleDisableArgs(body);

      const result = body.isDisabled
        ? await disablePool(accessToken, body.poolAddress, userAddress as string)
        : await enablePool(accessToken, body.poolAddress, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Multi-token pool operations
  static async swapMultiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateMultiTokenSwapArgs(body);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const result = await exchangeMultiToken(accessToken, { ...body, deadline }, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async addLiquidityMultiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateMultiTokenAddLiquidityArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const result = await addLiquidityMultiToken(
        accessToken,
        { ...body, poolAddress: params.poolAddress, deadline },
        userAddress as string
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removeLiquidityMultiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateMultiTokenRemoveLiquidityArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const result = await removeLiquidityMultiToken(
        accessToken,
        { ...body, poolAddress: params.poolAddress, deadline },
        userAddress as string
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removeLiquidityMultiTokenOneCoin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateMultiTokenRemoveLiquidityOneArgs(body);
      validatePoolAddressArgs(params);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 5;
      const result = await removeLiquidityMultiTokenOneCoin(
        accessToken,
        { ...body, poolAddress: params.poolAddress, deadline },
        userAddress as string
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

}

export default SwappingController;
