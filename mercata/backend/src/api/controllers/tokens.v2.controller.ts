import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getBalanceHistory,
  getBorrowingHistory,
  getEarningAssets,
  getNetBalanceHistory,
  getPoolPriceHistory,
  getTokens
} from "../services/tokens.v2.service";
import { validateQueryParams } from "../validators/tokens.validator";
import { buildTokenSelectFields } from "../../config/tokensConstants";
import { getHistoryParams } from "../helpers/history.helper";

class TokensV2Controller {
  static async getUserTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const { priorityToken, ...restQuery } = query as Record<string, string>;
      const queryParams: Record<string, string | undefined> = {
        ...restQuery,
        "balances.key": `eq.${userAddress}`,
        select: buildTokenSelectFields({ images: true, attributes: true, balanceInner: true }).join(","),
        limit: Math.min(parseInt(query.limit as string) || 10, 50).toString(),
        offset: (parseInt(query.offset as string) || 0).toString(),
      };

      const result = await getTokens(accessToken, userAddress, queryParams, priorityToken);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getEarningAssets(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const tokens = await getEarningAssets(accessToken, userAddress);
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async getBalanceHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, query, address: userAddress } = req;

      const { tokenAddress } = params;

      const historyParams = getHistoryParams(`${query?.duration || '1d'}`, query.end ? `${query.end}` : undefined);

      const result = await getBalanceHistory(accessToken, userAddress, tokenAddress, historyParams);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getNetBalanceHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;

      const historyParams = getHistoryParams(`${query?.duration || '1d'}`, query.end ? `${query.end}` : undefined);

      const result = await getNetBalanceHistory(accessToken, userAddress, historyParams);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getBorrowingHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;

      const historyParams = getHistoryParams(`${query?.duration || '1d'}`, query.end ? `${query.end}` : undefined);

      const result = await getBorrowingHistory(accessToken, userAddress, historyParams);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getPoolPriceHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, query, address: userAddress } = req;

      const { poolAddress } = params;

      const historyParams = getHistoryParams(`${query?.duration || '1d'}`, query.end ? `${query.end}` : undefined);

      const result = await getPoolPriceHistory(accessToken, userAddress, poolAddress, historyParams);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default TokensV2Controller;

