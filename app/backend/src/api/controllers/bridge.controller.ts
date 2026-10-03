import { Request, Response, NextFunction } from "express";
import { 
  requestWithdrawal,
  getWithdrawalCancellation,
  cancelUserWithdrawal,
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
import { getAdminBridgePolicies, getAdminBridgeReviews, prepareAdminBridgeReview } from "../services/bridgeReview.service";
import { StratoError } from "../../errors";
import { requestContext } from "../../utils/requestContext";
import type { BridgeProtocol } from "../../types/types";

const createBridgeController = (protocol: BridgeProtocol) => class BridgeController {
  static async policies(req: Request, res: Response): Promise<void> {
    if (!(await isUserAdmin(req.accessToken, req.address as string))) {
      res.status(403).json({ error: "Administrator access is required" }); return;
    }
    try { res.json(await getAdminBridgePolicies(req.accessToken)); }
    catch { res.status(503).json({ error: "Indexed bridge policies are unavailable. Refresh after the STRATO connection recovers." }); }
  }

  static async reviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await isUserAdmin(req.accessToken, req.address as string))) {
        res.status(403).json({ error: "Administrator access is required" });
        return;
      }
      if (req.method === "POST" && (typeof req.body?.id !== "string" || req.body.id.length > 256 || !["approve", "reject", "refund", "confirm_refund", "cancel_withdrawal", "confirm_cancellation"].includes(req.body?.action))) {
        res.status(400).json({ error: "Invalid review action" });
        return;
      }
      res.json(req.method === "POST"
        ? await prepareAdminBridgeReview(req.accessToken, req.body.id, req.body.action)
        : await getAdminBridgeReviews(req.accessToken, req.address as string));
    } catch (error: any) {
      if (error instanceof StratoError) { res.status(error.status).json({ error: error.message }); return; }
      if (error.response?.status === 409 && typeof error.response?.data?.error === "string") {
        res.status(409).json({ error: error.response.data.error });
        return;
      }
      next(new Error("Bridge review request failed; check STRATO connectivity or the requested operation"));
    }
  }

  static async cancelWithdrawal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.address) throw new StratoError("Account required", 401);
      const input = req.method === "GET" ? req.query : req.body;
      if (!input || typeof input.source !== "string" || typeof input.withdrawalId !== "string") throw new StratoError("Source and withdrawal ID are required", 400);
      const result = req.method === "GET"
        ? await getWithdrawalCancellation(req.accessToken, input.source, input.withdrawalId, req.address as string)
        : await cancelUserWithdrawal(req.accessToken, input.source, input.withdrawalId, req.address as string);
      res.json(result);
    } catch (error) { next(error); }
  }

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
      if (!userAddress || !/^(0x)?[a-f0-9]{40}$/i.test(userAddress)) {
        res.status(401).json({ error: "Authenticated account required" });
        return;
      }
      const { type } = req.params;
      const rawQueryParams = validateRawParams(req.query);
      
      const { context, ...queryParams } = rawQueryParams;
      
      const validatedType = validateTransactionType(type);
      
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      const adminHistory = context === 'admin' && isAdmin && !requestContext.getStore()?.externalSigning;
      const addressToUse = adminHistory ? undefined : userAddress;
      
      const result: BridgeTransactionResponse = await getBridgeTransactions(accessToken, validatedType, addressToUse, queryParams, adminHistory ? "all" : protocol);
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
