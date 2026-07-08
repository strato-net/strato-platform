import { Request, Response, NextFunction } from "express";
import { 
  requestWithdrawal,
  requestNativeWithdrawal as requestNativeWithdrawalService,
  requestDepositAction,
  getDepositActions,
  getBridgeableTokens,
  getNetworkConfigs,
  getBridgeTransactions,
  getWithdrawalSummary
} from "../services/bridge.service";
import {
  validateRequestWithdrawal,
  validateDepositAction,
  validateTransactionType,
  validateWithdrawalAuditId,
  validateWithdrawalAuditRouteType,
} from "../validators/bridge.validators";
import {
  getRecentWithdrawalAudits,
  getWithdrawalAudit,
} from "../services/withdrawalAudit.service";
import { validateRawParams } from "../validators/common.validators";
import {
  NetworkConfig,
  BridgeToken,
  BridgeTransactionResponse,
  WithdrawalRequestParams,
  DepositActionRequestParams,
  TransactionResponse,
  WithdrawalSummaryResponse,
  WithdrawalAuditStatusGroup
} from "@mercata/shared-types";
import { isUserAdmin } from "../services/user.service";

class BridgeController {
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
            userAddress as string
          )
        : await requestWithdrawal(accessToken, params, userAddress as string);

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
        userAddress as string
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async requestDepositAction(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      validateDepositAction(body);
   
      const result: TransactionResponse = await requestDepositAction(accessToken, body as DepositActionRequestParams, userAddress as string);
   
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
      const result = await getDepositActions(accessToken);
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
      
      const bridgeRoutes: BridgeToken[] = await getBridgeableTokens(accessToken, chainId);
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
      
      const { context, ...queryParams } = rawQueryParams;
      
      const validatedType = validateTransactionType(type);
      
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      const addressToUse = (context === 'admin' && isAdmin) ? undefined : userAddress;
      
      const result: BridgeTransactionResponse = await getBridgeTransactions(accessToken, validatedType, addressToUse, queryParams);
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
      const result: WithdrawalSummaryResponse = await getWithdrawalSummary(accessToken, userAddress as string);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getRecentWithdrawalAudits(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 10);
      const parsedMaxDepth = Number(req.query.maxDepth);
      const maxDepth = Number.isSafeInteger(parsedMaxDepth) && parsedMaxDepth > 0
        ? parsedMaxDepth
        : undefined;
      const statusGroup = ["initiated", "pending-review", "aborted", "complete"].includes(String(req.query.statusGroup))
        ? String(req.query.statusGroup) as WithdrawalAuditStatusGroup
        : "initiated";
      const result = await getRecentWithdrawalAudits(limit, maxDepth, statusGroup);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getWithdrawalAudit(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const routeType = validateWithdrawalAuditRouteType(req.params.routeType);
      const withdrawalId = validateWithdrawalAuditId(req.params.withdrawalId);
      const parsedMaxDepth = Number(req.query.maxDepth);
      const maxDepth = Number.isSafeInteger(parsedMaxDepth) && parsedMaxDepth > 0
        ? parsedMaxDepth
        : undefined;
      const result = await getWithdrawalAudit(routeType, withdrawalId, maxDepth);
      if (!result) {
        res.status(404).json({ error: "Withdrawal not found" });
        return;
      }

      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

export default BridgeController;
