import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  setPrice,
  getPrice,
  getPriceHistory,
} from "../services/oracle.service";
import { validateGetPriceHistoryInput, validateGetPriceQuery, validateSetPriceInput } from "../validators/oracle.validators";

class OracleController {
  static async getPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const asset = typeof query.asset === "string" ? query.asset : undefined;  

      const result = await getPrice(accessToken, asset);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateSetPriceInput(body);
      const result = await setPrice(accessToken, userAddress as string, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getPriceHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      const { assetAddress } = params;

      validateGetPriceHistoryInput(assetAddress);

      const result = await getPriceHistory(accessToken, assetAddress, query as Record<string, string | undefined>);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default OracleController;
