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
  executeRoute,
  getRouteAssets,
  getRouteQuote,
} from "../services/route.service";
import { getCompositeBridgeRouteQuote } from "../services/bridge-route.service";
import {
  validateTradeTokenArgs,
  validateTradePairArgs,
  validateTradeQuoteArgs,
  validateTradeSwapArgs,
  validateTradeHistoryQuery,
  validateCompositeRouteQuoteArgs,
  validateRouteExecuteArgs,
  validateRouteQuoteArgs,
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

  static async routeQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      validateRouteQuoteArgs(query);
      const result = await getRouteQuote(
        accessToken,
        query.tokenIn as string,
        query.tokenOut as string,
        BigInt(query.amount as string),
        query.slippageBps === undefined ? undefined : Number(query.slippageBps)
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async routeAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await getRouteAssets(
        req.accessToken,
        req.address as string | undefined
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async compositeRouteQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      validateCompositeRouteQuoteArgs(query);
      const result = await getCompositeBridgeRouteQuote(
        accessToken,
        query.externalChainId as string,
        query.externalToken as string,
        query.targetStratoToken as string,
        query.tokenOut as string,
        BigInt(query.amount as string),
        query.slippageBps === undefined ? undefined : Number(query.slippageBps)
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async route(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateRouteExecuteArgs(body);
      const result = await executeRoute(
        accessToken,
        body,
        userAddress as string
      );
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
