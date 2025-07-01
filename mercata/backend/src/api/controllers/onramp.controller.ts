import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { get, sell, buy, handleStripeWebhook } from "../services/onramp.service";

class OnRampController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;

      const token = await get(accessToken);
      res.status(RestStatus.OK).json(token);
    } catch (error) {
      next(error);
    }
  }

  static async sell(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;

      const result = await sell(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async buy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    console.log("=== BUY ENDPOINT HIT ===");
    console.log("Headers:", req.headers);
    console.log("Body type:", typeof req.body);
    console.log("Body:", req.body);

    try {
      const { accessToken, address, body } = req;

      const result = await buy(accessToken, address, body);

      res.status(RestStatus.OK).json({ url: result.url });
    } catch (error) {
      next(error);
    }
  }
  
}

export default OnRampController;
