import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getBalanceHistory, getEarningAssets, getTokens } from "../services/tokens.v2.service";
import { validateQueryParams } from "../validators/tokens.validator";
import { buildTokenSelectFields } from "../../config/tokensConstants";

class TokensV2Controller {
  static async getUserTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const queryParams: Record<string, string | undefined> = {
        ...query,
        "balances.key": `eq.${userAddress}`,
        select: buildTokenSelectFields({ images: true, attributes: true, balanceInner: true }).join(","),
        limit: Math.min(parseInt(query.limit as string) || 10, 50).toString(),
        offset: (parseInt(query.offset as string) || 0).toString(),
      };

      const result = await getTokens(accessToken, queryParams);
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
      const { accessToken, query, address: userAddress } = req;

      const endTimestamp = query.end ? parseInt(`${query.end}`) : Date.now();

      const duration = query.duration || '1d';
      let interval = 1000 * 5 * 60; // 5 minutes
      let numTicks = 12 * 24; // 5 minutes * 288 = 24 hours
      switch (duration) {
        case '5d': {
          interval = 1000 * 60 * 30; // 30 minutes
          numTicks = 5 * 48;
          break;
        }
        case '7d': {
          interval = 1000 * 60 * 30; // 30 minutes
          numTicks = 7 * 48;
          break;
        }
        case '1m': {
          interval = 1000 * 60 * 60 * 2; // 2 hours
          numTicks = 372; // 1 month
          break;
        }
        case '3m': {
          interval = 1000 * 60 * 60 * 6; // 6 hours
          numTicks = 368; // 3 months
          break;
        }
        case '6m': {
          interval = 1000 * 60 * 60 * 12; // 12 hours
          numTicks = 366; // 6 months
          break;
        }
        case '1y': {
          interval = 1000 * 60 * 60 * 24; // 1 day
          numTicks = 366; // 12 months
          break;
        }
        case 'all': {
          const genesisTimestamp = Date.parse('2025-10-30T00:00:00Z');
          const dt = endTimestamp - genesisTimestamp;
          interval = Number(dt/360);
          numTicks = 360;
          break;
        }
      }

      const result = await getBalanceHistory(accessToken, userAddress, endTimestamp, interval, numTicks);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default TokensV2Controller;

