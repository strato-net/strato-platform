import { Request, Response, NextFunction } from "express";
import { 
  requestWithdrawal, 
  getBridgeableTokens,
  getRedeemableTokens,
  getNetworkConfigs,
  getBridgeTransactions
} from "../services/bridge.service";
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
      const rawQueryParams = validateRawParams(req.query);
      
      // Extract 'all' parameter for admin view control, exclude it from query params
      const { all, ...queryParams } = rawQueryParams;
      
      const validatedType = validateTransactionType(type);
      // If 'all' query param is true, don't filter by userAddress (admin view)
      // Otherwise, filter by the authenticated user's address
      const addressToUse = all === 'true' ? undefined : userAddress;
      const result: BridgeTransactionResponse = await getBridgeTransactions(accessToken, validatedType, addressToUse, queryParams);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

export default BridgeController;

