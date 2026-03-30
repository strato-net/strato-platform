import { Request, Response, NextFunction } from "express";
import {
  getQuote,
  getLimits,
  getAvailableRoutes,
  getDepositStatus,
  initiateIntent,
  initiateIntentBySymbol,
  getSupportedTokens,
} from "../services/acrossService";

class AcrossController {
  /**
   * GET /across/quote
   * Query: originChainId, destinationChainId, inputToken, outputToken, amount
   */
  static async getQuote(req: Request, res: Response, next: NextFunction) {
    const { originChainId, destinationChainId, inputToken, outputToken, amount } = req.query;
    if (!originChainId || !destinationChainId || !inputToken || !outputToken || !amount) {
      return res.status(400).json({
        error: "Missing required parameters: originChainId, destinationChainId, inputToken, outputToken, amount",
      });
    }

    try {
      const quote = await getQuote({
        originChainId: Number(originChainId),
        destinationChainId: Number(destinationChainId),
        inputToken: String(inputToken),
        outputToken: String(outputToken),
        amount: String(amount),
      });
      res.status(200).json(quote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /across/limits
   * Query: originChainId, destinationChainId, inputToken, outputToken
   */
  static async getLimits(req: Request, res: Response, next: NextFunction) {
    const { originChainId, destinationChainId, inputToken, outputToken } = req.query;
    if (!originChainId || !destinationChainId || !inputToken || !outputToken) {
      return res.status(400).json({
        error: "Missing required parameters: originChainId, destinationChainId, inputToken, outputToken",
      });
    }

    try {
      const limits = await getLimits(
        Number(originChainId),
        Number(destinationChainId),
        String(inputToken),
        String(outputToken),
      );
      res.status(200).json(limits);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /across/routes
   * Query: originChainId? destinationChainId?
   */
  static async getRoutes(req: Request, res: Response, next: NextFunction) {
    try {
      const routes = await getAvailableRoutes(
        req.query.originChainId ? Number(req.query.originChainId) : undefined,
        req.query.destinationChainId ? Number(req.query.destinationChainId) : undefined,
      );
      res.status(200).json(routes);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /across/status
   * Query: originChainId, depositTxHash
   */
  static async getStatus(req: Request, res: Response, next: NextFunction) {
    const { originChainId, depositTxHash } = req.query;
    if (!originChainId || !depositTxHash) {
      return res.status(400).json({
        error: "Missing required parameters: originChainId, depositTxHash",
      });
    }

    try {
      const status = await getDepositStatus({
        originChainId: Number(originChainId),
        depositTxHash: String(depositTxHash),
      });
      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /across/initiate
   * Body: { originChainId, destinationChainId, inputToken, outputToken, inputAmount, recipient, message? }
   */
  static async initiate(req: Request, res: Response, next: NextFunction) {
    const {
      originChainId,
      destinationChainId,
      inputToken,
      outputToken,
      inputAmount,
      recipient,
      message,
    } = req.body;

    if (!originChainId || !destinationChainId || !inputToken || !outputToken || !inputAmount || !recipient) {
      return res.status(400).json({
        error: "Missing required parameters: originChainId, destinationChainId, inputToken, outputToken, inputAmount, recipient",
      });
    }

    try {
      const result = await initiateIntent({
        originChainId: Number(originChainId),
        destinationChainId: Number(destinationChainId),
        inputToken: String(inputToken),
        outputToken: String(outputToken),
        inputAmount: String(inputAmount),
        recipient: String(recipient),
        message: message ? String(message) : undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /across/initiate-by-symbol
   * Body: { originChainId, destinationChainId, symbol, inputAmount, recipient }
   */
  static async initiateBySymbol(req: Request, res: Response, next: NextFunction) {
    const { originChainId, destinationChainId, symbol, inputAmount, recipient } = req.body;

    if (!originChainId || !destinationChainId || !symbol || !inputAmount || !recipient) {
      return res.status(400).json({
        error: "Missing required parameters: originChainId, destinationChainId, symbol, inputAmount, recipient",
      });
    }

    try {
      const result = await initiateIntentBySymbol(
        Number(originChainId),
        Number(destinationChainId),
        String(symbol),
        String(inputAmount),
        String(recipient),
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /across/tokens
   * Query: chainId
   */
  static async getTokens(req: Request, res: Response, next: NextFunction) {
    const { chainId } = req.query;
    if (!chainId) {
      return res.status(400).json({ error: "Missing required parameter: chainId" });
    }

    try {
      const tokens = getSupportedTokens(Number(chainId));
      res.status(200).json(tokens);
    } catch (error) {
      next(error);
    }
  }
}

export default AcrossController;
