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
  buildBaseAnchorChainInputsViaCannon,
  buildBaseAnchorInputsViaCannon,
  buildBaseClaimInputs,
  NoMatchingDisputeGameError,
  UnsupportedL2ChainError,
} from "../services/baseProof.service";
import {
  loadTrustlessConfig,
  trustlessClaim,
  TrustlessClaimParams,
} from "../services/trustlessBridge.service";

/** Source chain ids the Cannon (OP-Stack) path covers. */
const BASE_CHAIN_IDS = new Set(["8453", "84532"]);
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
   * GET /bridge/baseAnchorInputs/:chainId/:txHash
   *
   * Trustless bridge-in (Cannon path): builds the calldata the user
   * submits to BaseLightClient.anchorBaseBlockViaCannon on STRATO,
   * plus the L1 anchor inputs the frontend needs to anchor the L1
   * block first. Returns 425 when no DGC matches (proposer hasn't
   * claimed the user's block yet) and 409 / 425 for the same Eth-side
   * failure modes the L1 anchor surfaces.
   */
  static async getBaseAnchorInputs(
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
      const inputs = await buildBaseAnchorInputsViaCannon(chainId, txHash);
      res.json({ success: true, data: inputs });
    } catch (error: any) {
      if (error instanceof UnsupportedL2ChainError) {
        res.status(400).json({ error: error.message, code: "UNSUPPORTED_L2_CHAIN" });
        return;
      }
      if (error instanceof NoMatchingDisputeGameError) {
        res.status(425).json({ error: error.message, code: "NO_MATCHING_DISPUTE_GAME" });
        return;
      }
      if (error instanceof NotFinalizedYetError) {
        res.status(425).json({ error: error.message, code: "NOT_FINALIZED_YET" });
        return;
      }
      if (error instanceof DepositTooOldError) {
        res.status(409).json({ error: error.message, code: "DEPOSIT_TOO_OLD" });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /bridge/baseAnchorChainInputs/:chainId/:txHash
   *
   * Trustless bridge-in (Cannon, parent-chain): builds the calldata
   * for {BaseLightClient.anchorBaseBlockChainViaCannon}. Used when no
   * DGC exists for the deposit's exact block (typical for fresh
   * deposits) — the backend locates a covering DGC whose claimed L2
   * block ≥ deposit block, fetches Base headers from the anchor down
   * to the deposit, and returns the full bundle.
   */
  static async getBaseAnchorChainInputs(
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
      const inputs = await buildBaseAnchorChainInputsViaCannon(chainId, txHash);
      res.json({ success: true, data: inputs });
    } catch (error: any) {
      if (error instanceof UnsupportedL2ChainError) {
        res.status(400).json({ error: error.message, code: "UNSUPPORTED_L2_CHAIN" });
        return;
      }
      if (error instanceof NoMatchingDisputeGameError) {
        res.status(425).json({ error: error.message, code: "NO_MATCHING_DISPUTE_GAME" });
        return;
      }
      if (error instanceof NotFinalizedYetError) {
        res.status(425).json({ error: error.message, code: "NOT_FINALIZED_YET" });
        return;
      }
      if (error instanceof DepositTooOldError) {
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
   *
   * Dispatches on chainId: Base-flavoured chains use {buildBaseClaimInputs}
   * (Base RPC, identical receipts-trie semantics); everything else
   * goes through the original Eth-path builder.
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
      const inputs = BASE_CHAIN_IDS.has(chainId)
        ? await buildBaseClaimInputs(chainId, txHash, depositRoutedSig)
        : await buildClaimInputs(chainId, txHash, depositRoutedSig);
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
   * GET /bridge/trustlessConfig/:chainId
   *
   * Surfaces the on-chain bridge-in / light-client deployment
   * addresses + the DepositRouted event sig for `chainId`. The
   * frontend reads this once per source chain so it can label
   * phases / render explorer links without baking addresses.
   *
   * Eth-flavor chains return `{flavor:"eth", bridgeIn, lightClient,
   * depositRoutedSig}`. Base-flavor chains additionally include
   * `l1LightClient` (the L1 EthLightClient that BaseLightClient
   * wraps).
   */
  static async getTrustlessConfig(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { chainId } = req.params;
      if (!chainId) {
        res.status(400).json({ error: "chainId path param required" });
        return;
      }
      const cfg = await loadTrustlessConfig(accessToken, chainId);
      res.json({ success: true, data: cfg });
    } catch (error: any) {
      if (typeof error?.message === "string" && error.message.includes("trustless path disabled")) {
        res.status(503).json({ error: error.message, code: "TRUSTLESS_DISABLED" });
        return;
      }
      if (typeof error?.message === "string" && error.message.includes("not supported")) {
        res.status(400).json({ error: error.message, code: "UNSUPPORTED_CHAIN" });
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
