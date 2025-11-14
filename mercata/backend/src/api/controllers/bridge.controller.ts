import { Request, Response, NextFunction } from "express";
import { 
  requestWithdrawal, 
  getBridgeableTokens,
  getRedeemableTokens,
  getNetworkConfigs,
  getBridgeTransactions
} from "../services/bridge.service";
import { createIntent } from "../services/bridgeEventPolling.service";
import { validateRequestWithdrawal, validateTransactionType } from "../validators/bridge.validators";
import { validateRawParams } from "../validators/common.validators";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, WithdrawalRequestResponse } from "@mercata/shared-types";

class BridgeController {
  static async requestWithdrawal(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateRequestWithdrawal(body);
      
      const result: WithdrawalRequestResponse = await requestWithdrawal(accessToken, body as WithdrawalRequestParams, userAddress as string);

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
      
      const result: BridgeToken[] = await getBridgeableTokens(accessToken, chainId);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getRedeemableTokens(
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
      
      const result: BridgeToken[] = await getRedeemableTokens(accessToken, chainId);
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
      const result: NetworkConfig[] = await getNetworkConfigs(accessToken);
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
      const { accessToken, address: userAddress } = req;
      const { type } = req.params;
      const queryParams = validateRawParams(req.query);
      
      const validatedType = validateTransactionType(type);
      const result: BridgeTransactionResponse = await getBridgeTransactions(accessToken, validatedType, userAddress, queryParams);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async autoSave(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { externalChainId, externalTxHash } = req.body;

      console.log(`[BridgeController] Auto save request:`, { externalChainId, externalTxHash });

      if (!externalChainId || !externalTxHash) {
        res.status(400).json({ error: "externalChainId and externalTxHash are required" });
        return;
      }

      createIntent(accessToken, externalChainId, externalTxHash);

      res.json({ success: true });
    } catch (error: any) {
      next(error);
    }
  }
}

export default BridgeController;

