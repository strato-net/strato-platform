import { Request, Response, NextFunction } from "express";
import {
  getAllWithdrawals,
  getAllDeposits,
  getWithdrawalById,
  abortWithdrawal,
  abortDeposit,
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

  static getWithdrawal = handleAsync(async (req: Request, res: Response) => {
    const { accessToken } = req;
    const data = await getWithdrawalById(accessToken, req.params.id);
    if (!data) {
      res.status(404).json({ error: "Withdrawal not found" });
      return;
    }
    res.json(data);
  });

  static abortWithdrawal = handleAsync(async (req: Request, res: Response) => {
    const { accessToken, address: userAddress } = req;
    const result = await abortWithdrawal(accessToken, userAddress as string, req.params.id);
    res.json({ success: true, data: result });
  });

  static abortDeposit = handleAsync(async (req: Request, res: Response) => {
    const { accessToken, address: userAddress } = req;
    const { chainId, txHash } = req.body;
    const result = await abortDeposit(accessToken, userAddress as string, chainId, txHash);
    res.json({ success: true, data: result });
  });
}

export default BridgeAdminController;
