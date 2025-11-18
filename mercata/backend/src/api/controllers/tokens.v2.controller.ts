import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEarningAssets, getTokens } from "../services/tokens.v2.service";
import { validateQueryParams } from "../validators/tokens.validator";
import { TOKENS_V2_SELECT_FIELDS, TOKENS_V2_BALANCES_FIELD } from "../../config/tokensConstants";

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
        select: [...TOKENS_V2_SELECT_FIELDS, TOKENS_V2_BALANCES_FIELD].join(","),
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
}

export default TokensV2Controller;

