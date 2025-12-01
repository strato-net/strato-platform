import { requestAutoSave } from "../services/autosaveService";
import { Request, Response, NextFunction } from "express";

class AutoSaveController {
  static async requestAutoSave(req: Request, res: Response, next: NextFunction) {
    // Get user address from token
    let userAddress: string = res.locals.userAddress;
  
    // Extract and validate request parameters
    const { externalChainId, externalTxHash } = req.body;
    if (!externalChainId || !externalTxHash) {
      return res.status(400).json({
        error: "Missing required parameters: externalChainId and externalTxHash"
      });
    }
  
    // Call the logic function, which executes the smart contract call
    try {
      const result = await requestAutoSave({ userAddress, externalChainId, externalTxHash });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default AutoSaveController;