import { Request, Response, NextFunction } from "express";
import {
  requestWithdrawal,
  requestDepositAction,
  getDepositActions,
  getBridgeableTokens,
  getNetworkConfigs,
  getBridgeTransactions,
  getWithdrawalSummary,
  getWithdrawalProof,
  getWithdrawalProofForSeq,
} from "../services/bridge.service";
import { validateRequestWithdrawal, validateDepositAction, validateTransactionType } from "../validators/bridge.validators";
import { validateRawParams } from "../validators/common.validators";
import {
  NetworkConfig,
  BridgeToken,
  BridgeTransactionResponse,
  WithdrawalRequestParams,
  DepositActionRequestParams,
  TransactionResponse,
  WithdrawalSummaryResponse,
  WithdrawalTransactionResponse,
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

      const result: WithdrawalTransactionResponse = await requestWithdrawal(accessToken, body as WithdrawalRequestParams, userAddress as string);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /bridge/withdrawalProof/:txHash
   *
   * Standalone proof lookup for a previously-submitted requestWithdrawalProof
   * tx. Used by the external-signing path (where the backend doesn't see the
   * finalized tx synchronously) and as a retry hook if the inline proof fetch
   * in requestWithdrawal failed transiently.
   */
  static async getWithdrawalProof(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { txHash } = req.params;
      if (!txHash) {
        res.status(400).json({ error: "txHash parameter is required" });
        return;
      }

      const proof = await getWithdrawalProof(accessToken, txHash);
      if (!proof) {
        res.status(404).json({ error: "No withdrawal proof available for that tx" });
        return;
      }

      res.json({ success: true, data: proof });
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * GET /bridge/withdrawalProof/byBlock/:chainId/:blockNumber/:seq
   *
   * Lookup a Withdrawal proof by its (chainId, blockNumber, seq) tuple,
   * scanning the block for a matching hot-path log. Used by the UI's
   * catch-up flow: when the user's own seq is ahead of the vault's
   * nextSeqToProcess, the UI walks the prevWithdrawalBlock chain backwards
   * and uses this endpoint to fetch each predecessor's proof.
   */
  static async getWithdrawalProofForSeq(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { chainId, blockNumber, seq } = req.params;
      const cid = Number(chainId);
      const bn = Number(blockNumber);
      const s = Number(seq);
      if (!Number.isFinite(cid) || !Number.isFinite(bn) || !Number.isFinite(s)) {
        res.status(400).json({ error: "chainId, blockNumber, and seq must all be numeric" });
        return;
      }

      const proof = await getWithdrawalProofForSeq(accessToken, cid, bn, s);
      if (!proof) {
        res.status(404).json({
          error: `No Withdrawal proof for chain ${cid} seq ${s} in block ${bn}`,
        });
        return;
      }

      res.json({ success: true, data: proof });
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
}

export default BridgeController;
