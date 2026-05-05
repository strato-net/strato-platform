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
import {
  buildAnchorInputs,
  buildClaimInputs,
  DepositTooOldError,
  NotFinalizedYetError,
} from "../services/bridgeProof.service";
import {
  loadTrustlessConfig,
  trustlessClaim,
  TrustlessClaimParams,
} from "../services/trustlessBridge.service";
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

  /**
   * GET /bridge/anchorInputs/:chainId/:txHash
   *
   * Trustless bridge-in: builds the calldata the user submits to
   * EthLightClient.anchorBlockHeader on STRATO. The deposit must
   * already be finalized on the source chain; otherwise we return
   * 425 Too Early so the UI can poll/retry.
   */
  static async getAnchorInputs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { chainId, txHash } = req.params;
      if (!chainId || !txHash) {
        res.status(400).json({ error: "chainId and txHash are required" });
        return;
      }
      const inputs = await buildAnchorInputs(chainId, txHash);
      res.json({ success: true, data: inputs });
    } catch (error: any) {
      if (error instanceof NotFinalizedYetError) {
        res.status(425).json({ error: "deposit not yet finalized; retry after finality lag", code: "NOT_FINALIZED_YET" });
        return;
      }
      if (error instanceof DepositTooOldError) {
        // Older than the live finalized head — would need parent-chain
        // anchoring, which v1 doesn't support.
        res.status(409).json({ error: error.message, code: "DEPOSIT_TOO_OLD" });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /bridge/claimInputs/:chainId/:txHash?depositRoutedSig=0x...
   *
   * Trustless bridge-in: builds the calldata the user submits to
   * EthBridgeIn.claim on STRATO once the corresponding block is
   * anchored. depositRoutedSig is the keccak256 hash of the
   * `DepositRouted(...)` event signature — the frontend reads it
   * from the EthBridgeIn contract and forwards it here so we can
   * locate the right log inside the receipt.
   */
  static async getClaimInputs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { chainId, txHash } = req.params;
      const depositRoutedSig = req.query.depositRoutedSig;
      if (!chainId || !txHash) {
        res.status(400).json({ error: "chainId and txHash are required" });
        return;
      }
      if (typeof depositRoutedSig !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(depositRoutedSig)) {
        res.status(400).json({ error: "depositRoutedSig query param required (32-byte hex hash)" });
        return;
      }
      const inputs = await buildClaimInputs(chainId, txHash, depositRoutedSig);
      res.json({ success: true, data: inputs });
    } catch (error: any) {
      if (error?.message?.includes("no DepositRouted log")) {
        res.status(404).json({ error: error.message, code: "NO_DEPOSIT_LOG" });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /bridge/trustlessConfig
   *
   * Surfaces the on-chain EthBridgeIn / EthLightClient deployment
   * addresses + the DepositRouted event sig the proof builder needs.
   * The frontend reads this once at mount so it can label phases and
   * render explorer links without baking addresses into the bundle.
   */
  static async getTrustlessConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const cfg = await loadTrustlessConfig(accessToken);
      res.json({ success: true, data: cfg });
    } catch (error: any) {
      if (typeof error?.message === "string" && error.message.includes("trustless path disabled")) {
        res.status(503).json({ error: error.message, code: "TRUSTLESS_DISABLED" });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /bridge/trustlessClaim
   *
   * End-to-end trustless deposit claim: builds the AnchorInputs +
   * ClaimInputs, packages them into a (anchorBlockHeader, claim)
   * STRATO tx batch, and submits via the standard wallet-signing
   * pipeline. Skips the anchor tx when the block is already on-chain.
   */
  static async trustlessClaim(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body, address: userAddress } = req;
      const { externalChainId, externalTxHash, assignment } = (body || {}) as TrustlessClaimParams;
      if (!externalChainId || !externalTxHash) {
        res.status(400).json({ error: "externalChainId and externalTxHash are required" });
        return;
      }
      const result = await trustlessClaim(
        accessToken,
        { externalChainId, externalTxHash, assignment },
        userAddress as string,
      );
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof NotFinalizedYetError) {
        res.status(425).json({ error: "deposit not yet finalized; retry after finality lag", code: "NOT_FINALIZED_YET" });
        return;
      }
      if (error instanceof DepositTooOldError) {
        res.status(409).json({ error: error.message, code: "DEPOSIT_TOO_OLD" });
        return;
      }
      if (typeof error?.message === "string" && error.message.includes("no DepositRouted log")) {
        res.status(404).json({ error: error.message, code: "NO_DEPOSIT_LOG" });
        return;
      }
      if (typeof error?.message === "string" && error.message.includes("trustless path disabled")) {
        res.status(503).json({ error: error.message, code: "TRUSTLESS_DISABLED" });
        return;
      }
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
