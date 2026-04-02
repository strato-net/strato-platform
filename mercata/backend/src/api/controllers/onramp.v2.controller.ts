import { Request, Response, NextFunction } from "express";
import {
  getCryptoQuote,
  createWidgetSession,
  verifyMeldWebhook,
  handleMeldTransactionUpdate,
  getDepositStatus,
  getUserTransactions,
} from "../services/onramp.v2.service";

class OnrampV2Controller {
  static async getQuote(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userAddress = req.address;
      const { sourceAmount, destinationCurrencyCode } = req.body;

      if (!sourceAmount || !destinationCurrencyCode) {
        res.status(400).json({
          success: false,
          error: { message: "sourceAmount and destinationCurrencyCode are required" },
        });
        return;
      }

      const result = await getCryptoQuote(userAddress, sourceAmount, destinationCurrencyCode);

      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.response) {
        console.error(`[OnrampV2] Quote error ${error.response.status}:`, JSON.stringify(error.response.data));
        res.status(error.response.status).json({
          success: false,
          error: { message: error.response.data?.message || error.response.data?.error || `Meld API error (${error.response.status})` },
        });
        return;
      }
      next(error);
    }
  }

  static async createSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userAddress = req.address;
      const { sourceAmount, destinationCurrencyCode, serviceProvider } = req.body;

      if (!sourceAmount || !destinationCurrencyCode || !serviceProvider) {
        res.status(400).json({
          success: false,
          error: { message: "sourceAmount, destinationCurrencyCode, and serviceProvider are required" },
        });
        return;
      }

      const result = await createWidgetSession(userAddress, sourceAmount, destinationCurrencyCode, serviceProvider);

      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.response) {
        console.error(`[OnrampV2] Session error ${error.response.status}:`, JSON.stringify(error.response.data));
        res.status(error.response.status).json({
          success: false,
          error: { message: error.response.data?.message || error.response.data?.error || `Meld API error (${error.response.status})` },
        });
        return;
      }
      next(error);
    }
  }

  static async handleWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const signature = req.headers["meld-signature"] as string;
      const timestamp = req.headers["meld-signature-timestamp"] as string;
      if (!signature || !timestamp) {
        res.status(400).json({ error: "Missing meld-signature or meld-signature-timestamp header" });
        return;
      }

      const rawBody = req.rawBody;
      if (!rawBody) {
        res.status(500).json({ error: "Raw body not available for signature verification" });
        return;
      }

      const rawBodyStr = rawBody.toString("utf-8");
      const valid = verifyMeldWebhook(rawBodyStr, timestamp, signature);
      if (!valid) {
        console.warn(`[OnrampV2] Invalid webhook signature`);
        res.status(400).json({ error: "Invalid webhook signature" });
        return;
      }

      const event = JSON.parse(rawBodyStr);
      console.log(`[OnrampV2] Webhook received — type=${event.eventType}, id=${event.eventId}`);

      const cryptoEvents = [
        "TRANSACTION_CRYPTO_PENDING",
        "TRANSACTION_CRYPTO_TRANSFERRING",
        "TRANSACTION_CRYPTO_COMPLETE",
        "TRANSACTION_CRYPTO_FAILED",
      ];

      if (cryptoEvents.includes(event.eventType)) {
        await handleMeldTransactionUpdate(event);
      }

      res.json({ received: true });
    } catch (error: any) {
      next(error);
    }
  }

  static async depositStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const txHash = query.txHash as string;
      if (!txHash) {
        res.status(400).json({ error: "txHash query parameter is required" });
        return;
      }
      const result = await getDepositStatus(accessToken, txHash);
      res.json({ success: true, data: result });
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
      const { accessToken, address: userAddress, query } = req;
      const { limit, offset } = query;
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (offset) params.offset = String(offset);
      const result = await getUserTransactions(accessToken, userAddress, params);
      res.json({ success: true, data: result });
    } catch (error: any) {
      next(error);
    }
  }
}

export default OnrampV2Controller;
