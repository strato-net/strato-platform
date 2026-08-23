import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getTradeTokens,
  getTradePairableTokens,
  getTradePools,
  getTradeQuotes,
  executeTradeSwap,
  getTradeHistory,
  getTradeTokenHistory,
} from "../services/trade.service";
import {
  validateTradeTokenArgs,
  validateTradePairArgs,
  validateTradeQuoteArgs,
  validateTradeSwapArgs,
  validateTradeHistoryQuery,
} from "../validators/trade.validator";

class TradeController {
  static async tokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const tokens = await getTradeTokens(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async pairableTokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, address: userAddress } = req;
      validateTradeTokenArgs(params);
      const tokens = await getTradePairableTokens(accessToken, params.tokenAddress, userAddress as string);
      res.status(RestStatus.OK).json(tokens);
    } catch (error) {
      next(error);
    }
  }

  static async pools(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validateTradePairArgs(params);
      const pools = await getTradePools(accessToken, params.tokenAddress1, params.tokenAddress2);
      res.status(RestStatus.OK).json(pools);
    } catch (error) {
      next(error);
    }
  }

  static async quote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      validateTradeQuoteArgs(query);
      const response = await getTradeQuotes(
        accessToken,
        query.tokenIn as string,
        query.tokenOut as string,
        BigInt(query.amount as string),
        query.type as "EXACT_INPUT" | "EXACT_OUTPUT"
      );
      res.status(RestStatus.OK).json(response);
    } catch (error) {
      next(error);
    }
  }

  static async swap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateTradeSwapArgs(body);
      const result = await executeTradeSwap(accessToken, body, userAddress as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateTradePairArgs(params);
      validateTradeHistoryQuery(query);
      const page = query.page ? parseInt(query.page as string, 10) : 1;
      const limit = query.limit ? parseInt(query.limit as string, 10) : 10;
      const history = await getTradeHistory(
        accessToken,
        params.tokenAddress1,
        params.tokenAddress2,
        page,
        limit,
        typeof query.sender === "string" ? query.sender : undefined
      );
      res.status(RestStatus.OK).json(history);
    } catch (error) {
      next(error);
    }
  }

  static async tokenHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateTradeTokenArgs(params);
      validateTradeHistoryQuery(query);
      const page = query.page ? parseInt(query.page as string, 10) : 1;
      const limit = query.limit ? parseInt(query.limit as string, 10) : 10;
      const history = await getTradeTokenHistory(accessToken, params.tokenAddress, page, limit);
      res.status(RestStatus.OK).json(history);
    } catch (error) {
      next(error);
    }
  }
}

export default TradeController;
