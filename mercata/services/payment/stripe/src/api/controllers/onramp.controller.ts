import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { checkout } from "../services/onramp.service";

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

}

export default OnRampController;