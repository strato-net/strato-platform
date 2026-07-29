import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getPools,
  getPoolByAddress,
  getPoolsByPair,
  getQuote,
  getPositions,
  getAmountsForLiquidity,
  getLiquidityDistribution,
  swap,
  mint,
  burn,
  collect,
  createPool,
} from "../services/poolV3.service";
import {
  validatePoolV3AddressArgs,
  validatePoolV3PairArgs,
  validatePoolV3QuoteArgs,
  validatePoolV3AmountsArgs,
  validatePoolV3SwapArgs,
  validatePoolV3MintArgs,
  validatePoolV3BurnArgs,
  validatePoolV3CollectArgs,
  validatePoolV3CreateArgs,
} from "../validators/poolV3.validator";

class PoolV3Controller {
  // ----- reads -----

  static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken } = req;
      const pools = await getPools(accessToken);
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async getByPair(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validatePoolV3PairArgs(params);
      const pools = await getPoolsByPair(accessToken, params.tokenAddress1, params.tokenAddress2);
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validatePoolV3AddressArgs(params);
      const pool = await getPoolByAddress(accessToken, params.poolAddress);
      if (!pool) throw new Error("PoolV3 not found");
      res.status(RestStatus.OK).json(pool);
    } catch (error) {
      next(error);
    }
  }

  static async liquidity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validatePoolV3AddressArgs(params);
      const distribution = await getLiquidityDistribution(accessToken, params.poolAddress);
      if (!distribution) throw new Error("PoolV3 not found");
      res.status(RestStatus.OK).json(distribution);
    } catch (error) {
      next(error);
    }
  }

  static async quote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      validatePoolV3QuoteArgs(query);
      const quote = await getQuote(
        accessToken,
        query.poolAddress as string,
        query.zeroForOne === "true",
        BigInt(query.amountSpecified as string)
      );
      res.status(RestStatus.OK).json(quote);
    } catch (error) {
      next(error);
    }
  }

  static async positions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, query } = req;
      if (!userAddress) throw new Error("User address is required");
      const positions = await getPositions(
        accessToken,
        userAddress,
        typeof query.poolAddress === "string" ? query.poolAddress : undefined
      );
      res.status(RestStatus.OK).json(positions);
    } catch (error) {
      next(error);
    }
  }

  static async amountsForLiquidity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      const args = {
        poolAddress: query.poolAddress,
        tickLower: Number(query.tickLower),
        tickUpper: Number(query.tickUpper),
        ...(query.liquidity ? { liquidity: query.liquidity } : {}),
        ...(query.amount0Desired ? { amount0Desired: query.amount0Desired } : {}),
        ...(query.amount1Desired ? { amount1Desired: query.amount1Desired } : {}),
      };
      validatePoolV3AmountsArgs(args);
      const preview = await getAmountsForLiquidity(
        accessToken,
        args.poolAddress as string,
        args.tickLower,
        args.tickUpper,
        query.liquidity ? BigInt(query.liquidity as string) : undefined,
        query.amount0Desired ? BigInt(query.amount0Desired as string) : undefined,
        query.amount1Desired ? BigInt(query.amount1Desired as string) : undefined
      );
      res.status(RestStatus.OK).json(preview);
    } catch (error) {
      next(error);
    }
  }

  // ----- writes -----

  static async swap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validatePoolV3SwapArgs(body);
      const result = await swap(accessToken, body, userAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async mint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validatePoolV3MintArgs(body);
      const result = await mint(accessToken, body, userAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async burn(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validatePoolV3BurnArgs(body);
      const result = await burn(accessToken, body, userAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async collect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validatePoolV3CollectArgs(body);
      const result = await collect(accessToken, body, userAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validatePoolV3CreateArgs(body);
      const result = await createPool(accessToken, body, userAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default PoolV3Controller;
