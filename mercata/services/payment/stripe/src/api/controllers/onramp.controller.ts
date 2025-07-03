import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { checkout, mintVouchers } from "../services/onramp.service";

class OnRampController {
  static async checkout(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { token, buyerAddress, baseUrl, amount } = req.body;

      const result = await checkout(token, buyerAddress, amount, baseUrl);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async mintVouchers(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "sessionId is required" });
        return;
      }

      await mintVouchers(sessionId);
      res.status(RestStatus.OK).json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

export default OnRampController;