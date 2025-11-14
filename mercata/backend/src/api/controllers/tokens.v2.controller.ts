import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEarningAssets, getTokens } from "../services/tokens.v2.service";
import { validateQueryParams } from "../validators/tokens.validator";

class TokensV2Controller {
  static async getUserTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query, address: userAddress } = req;
      validateQueryParams(query);

      const limit = Math.min(parseInt(query.limit as string) || 10, 50);
      const offset = parseInt(query.offset as string) || 0;
      const { select, ...queryWithoutSelect } = query;

      const queryParams: Record<string, string | undefined> = {
        ...queryWithoutSelect,
        "balances.key": `eq.${userAddress}`,
        limit: limit.toString(),
        offset: offset.toString(),
      };

      const { tokens, totalCount } = await getTokens(accessToken, queryParams);
      res.status(RestStatus.OK).json({ tokens, totalCount });
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
}

export default TokensV2Controller;

