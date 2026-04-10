import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  depositSaveUsdst,
  getSaveUsdstInfo,
  getSaveUsdstUserInfo,
  redeemAllSaveUsdst,
  redeemSaveUsdst,
} from "../services/saveUsdst.service";

const isPositiveIntegerString = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (!/^\d+$/.test(value.trim())) return false;

  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
};

class SaveUsdstController {
  static async getInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const info = await getSaveUsdstInfo(req.accessToken);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async getUserInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const info = await getSaveUsdstUserInfo(req.accessToken, req.address as string);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async deposit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { amount } = req.body || {};
      if (!isPositiveIntegerString(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }

      const result = await depositSaveUsdst(req.accessToken, req.address as string, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeem(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { sharesAmount } = req.body || {};
      if (!isPositiveIntegerString(sharesAmount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid shares amount" });
        return;
      }

      const result = await redeemSaveUsdst(req.accessToken, req.address as string, sharesAmount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async redeemAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await redeemAllSaveUsdst(req.accessToken, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default SaveUsdstController;
