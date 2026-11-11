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
import { getMarkets, getMarketCandles, getMarketTrades, getMarketStats } from "../services/marketData.service";
import {
  validateTradeTokenArgs,
  validateTradePairArgs,
  validateTradeQuoteArgs,
  validateTradeSwapArgs,
  validateTradeHistoryQuery,
  validateMarketArgs,
  validateMarketCandlesQuery,
  validateMarketTradesQuery,
} from "../validators/trade.validator";
import { CandleResolution } from "@strato/shared-types";

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

  static async markets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const markets = await getMarkets(req.accessToken);
      res.status(RestStatus.OK).json(markets);
    } catch (error) {
      next(error);
    }
  }

  static async marketCandles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateMarketArgs(params);
      validateMarketCandlesQuery(query);
      const candles = await getMarketCandles(
        accessToken,
        params.poolAddress,
        query.resolution as CandleResolution,
        query.from ? parseInt(query.from as string, 10) : undefined
      );
      res.status(RestStatus.OK).json(candles);
    } catch (error) {
      next(error);
    }
  }

  static async marketTrades(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateMarketArgs(params);
      validateMarketTradesQuery(query);
      const limit = query.limit ? parseInt(query.limit as string, 10) : 50;
      const trades = await getMarketTrades(accessToken, params.poolAddress, limit);
      res.status(RestStatus.OK).json(trades);
    } catch (error) {
      next(error);
    }
  }

  static async marketStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validateMarketArgs(params);
      const stats = await getMarketStats(accessToken, params.poolAddress);
      res.status(RestStatus.OK).json(stats);
    } catch (error) {
      next(error);
    }
  }
}

export default TradeController;
