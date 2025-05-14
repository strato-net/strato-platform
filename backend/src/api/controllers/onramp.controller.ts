import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { get, sell, lock, unlockTokens } from "../services/onramp.service";
// import {
//   validateAddressArgs,
//   validateCreateTokensArgs,
//   validateTransferItemArgs,
//   validateApproveArgs,
//   validateTransferFromArgs,
//   validateQueryParams
// } from "../validators/tokens.validator";

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

  static async onRampSell(
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

  static async onRampLock(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address,  body } = req;

      const result = await lock(accessToken, address, body);
      res.status(RestStatus.OK).json({ url: result.url });
    } catch (error) {
      next(error);
    }
  }

  static async unlockTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;

      const { listingId } = body;

      const result = await unlockTokens(accessToken, listingId);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default OnRampController;
