import { Request, Response, NextFunction } from "express";
import {
  getAllWithdrawals,
  getAllDeposits,
} from "../services/bridgeAdmin.service";

const handleAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };

class BridgeAdminController {
  static getWithdrawals = handleAsync(async (req: Request, res: Response) => {
    const { accessToken } = req;
    const { status, chainId, limit, offset } = req.query;
    const result = await getAllWithdrawals(accessToken, { status, chainId, limit, offset } as any);
    res.json({ data: result.data, totalCount: result.totalCount });
  });

  static getDeposits = handleAsync(async (req: Request, res: Response) => {
    const { accessToken } = req;
    const { status, chainId, limit, offset } = req.query;
    const result = await getAllDeposits(accessToken, { status, chainId, limit, offset } as any);
    res.json({ data: result.data, totalCount: result.totalCount });
  });
}

export default BridgeAdminController;
