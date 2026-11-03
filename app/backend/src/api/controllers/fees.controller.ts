import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getFeeQuote } from "../services/fees.service";

class FeesController {
  static async getQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      res.status(RestStatus.OK).json(await getFeeQuote(accessToken, userAddress));
    } catch (error) {
      next(error);
    }
  }
}

export default FeesController;
