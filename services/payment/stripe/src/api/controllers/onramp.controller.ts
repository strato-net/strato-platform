import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { lock } from "../services/onramp.service";

class OnRampController {
  static async onRampLock(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { listingId, buyerAddress, baseUrl } = req.body;

      const result = await lock(listingId, buyerAddress, baseUrl);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default OnRampController;
