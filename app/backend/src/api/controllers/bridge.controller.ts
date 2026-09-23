import { Request, Response, NextFunction } from "express";
import { 
  requestWithdrawal,
  requestNativeWithdrawal as requestNativeWithdrawalService,
  getDepositActions,
  getBridgeableTokens,
  getNetworkConfigs,
  getBridgeTransactions,
  getWithdrawalSummary
} from "../services/bridge.service";
import { validateRequestWithdrawal, validateTransactionType } from "../validators/bridge.validators";
import { validateRawParams } from "../validators/common.validators";
import {
  NetworkConfig,
  BridgeToken,
  BridgeTransactionResponse,
  WithdrawalRequestParams,
  TransactionResponse,
  WithdrawalSummaryResponse
} from "@strato/shared-types";
import { isUserAdmin } from "../services/user.service";
import type { BridgeProtocol } from "../../types/types";

const createBridgeController = (protocol: BridgeProtocol) => class BridgeController {
  static async requestWithdrawal(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateRequestWithdrawal(body);

      const params = body as WithdrawalRequestParams;
      const result: TransactionResponse = params.routeType === "native"
        ? await requestNativeWithdrawalService(
            accessToken,
            { ...params, routeType: "native" },
            userAddress as string,
            protocol
          )
        : await requestWithdrawal(accessToken, params, userAddress as string, protocol);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async requestNativeWithdrawal(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateRequestWithdrawal({ ...body, routeType: "native" });

      const result: TransactionResponse = await requestNativeWithdrawalService(
        accessToken,
        {
          ...(body as WithdrawalRequestParams),
          routeType: "native",
        },
        userAddress as string,
        protocol
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getDepositActions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const result = await getDepositActions(accessToken, protocol);
      res.json(result);
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
      
      const bridgeRoutes: BridgeToken[] = await getBridgeableTokens(accessToken, chainId, protocol);
      const enabledBridgeRoutes = bridgeRoutes.filter((route) => route.enabled);
      res.json(enabledBridgeRoutes);
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
      const result: NetworkConfig[] = await getNetworkConfigs(accessToken, protocol);
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
      
      const { context, ...queryParams } = rawQueryParams;
      
      const validatedType = validateTransactionType(type);
      
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      const addressToUse = (context === 'admin' && isAdmin) ? undefined : userAddress;
      
      const result: BridgeTransactionResponse = await getBridgeTransactions(accessToken, validatedType, addressToUse, queryParams, protocol);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getWithdrawalSummary(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const result: WithdrawalSummaryResponse = await getWithdrawalSummary(accessToken, userAddress as string, protocol);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
};

export const TradeBridgeController = createBridgeController("external");
export default createBridgeController("legacy");
