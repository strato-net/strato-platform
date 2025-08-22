import { Request, Response, NextFunction } from "express";
import { 
  bridgeOut, 
  getBridgeableTokens,
  getNetworkConfigs,
  getBridgeTransactions,
  getTokenLimit
} from "../services/bridge.service";
import { validateBridgeOut, validateTransactionType } from "../validators/bridge.validators";
import { validateRawParams } from "../validators/common.validators";

class BridgeController {
  static async bridgeOut(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateBridgeOut(body);
      
      const result = await bridgeOut(accessToken, body);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getBridgeableTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { chainId } = req.params;
      
      if (!chainId) {
        res.status(400).json({ error: "chainId parameter is required" });
        return;
      }
      
      const result = await getBridgeableTokens(accessToken, chainId);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getNetworkConfigs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const result = await getNetworkConfigs(accessToken);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address } = req;
      const { type } = req.params;
      const queryParams = validateRawParams(req.query);
      
      const validatedType = validateTransactionType(type);
      const result = await getBridgeTransactions(accessToken, validatedType, address, queryParams);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getTokenLimit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { tokenAddress } = req.params;
      
      if (!tokenAddress) {
        res.status(400).json({ error: "tokenAddress parameter is required" });
        return;
      }
      
      const result = await getTokenLimit(accessToken, tokenAddress);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

export default BridgeController;
