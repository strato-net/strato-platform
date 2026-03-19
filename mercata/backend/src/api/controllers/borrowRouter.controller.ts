import { NextFunction, Request, Response } from "express";
import RestStatus from "http-status-codes";
import { executeBorrowRoute, previewBorrowRoute } from "../services/borrowRouter.service";

class BorrowRouterController {
  static async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      if (!body || body.amount === undefined || body.amount === null) {
        throw new Error("amount is required");
      }
      const result = await previewBorrowRoute({
        accessToken,
        userAddress: userAddress as string,
        amount: String(body.amount),
        targetHealthFactor: body.targetHealthFactor ? Number(body.targetHealthFactor) : undefined,
        allocationRatio: body.allocationRatio !== undefined ? Number(body.allocationRatio) : undefined,
        lendingCollateral: Array.isArray(body.lendingCollateral) ? body.lendingCollateral : [],
        cdpCollateral: Array.isArray(body.cdpCollateral) ? body.cdpCollateral : [],
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async execute(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      if (!body || body.amount === undefined || body.amount === null) {
        throw new Error("amount is required");
      }
      const result = await executeBorrowRoute({
        accessToken,
        userAddress: userAddress as string,
        amount: String(body.amount),
        targetHealthFactor: body.targetHealthFactor ? Number(body.targetHealthFactor) : undefined,
        allocationRatio: body.allocationRatio !== undefined ? Number(body.allocationRatio) : undefined,
        lendingCollateral: Array.isArray(body.lendingCollateral) ? body.lendingCollateral : [],
        cdpCollateral: Array.isArray(body.cdpCollateral) ? body.cdpCollateral : [],
      });
      if (result.status !== "success") {
        res.status(RestStatus.CONFLICT).json(result);
        return;
      }
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default BorrowRouterController;

