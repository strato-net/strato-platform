import { requestDepositAction } from "../services/depositActionService";
import { Request, Response, NextFunction } from "express";

class DepositActionController {
  static async requestDepositAction(req: Request, res: Response, next: NextFunction) {
    let userAddress: string = res.locals.userAddress;
  
    const { externalChainId, externalTxHash, action, targetToken } = req.body;
    if (!externalChainId || !externalTxHash || !action) {
      return res.status(400).json({
        error: "Missing required parameters: externalChainId, externalTxHash, and action"
      });
    }
  
    try {
      const result = await requestDepositAction({
        userAddress,
        externalChainId,
        externalTxHash,
        action: Number(action),
        targetToken: targetToken || "0000000000000000000000000000000000000000",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default DepositActionController;
