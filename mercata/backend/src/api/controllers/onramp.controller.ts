import { Request, Response, NextFunction } from "express";
import {
  createOnrampSession,
  verifyWebhookSignature,
  handleSessionUpdate,
  getUserTransactions,
} from "../services/onramp.service";

class OnrampController {
  static async createSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userAddress = req.address;
      const clientIp =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "";

      const result = await createOnrampSession(userAddress, clientIp);
      res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.type === "StripeInvalidRequestError") {
        const code = error.raw?.code || error.code;
        if (code === "crypto_onramp_unsupportable_customer") {
          res.status(400).json({
            success: false,
            error: { message: "Onramp is not available in your region", code },
          });
          return;
        }
        if (code === "crypto_onramp_disabled") {
          res.status(503).json({
            success: false,
            error: { message: "Onramp is temporarily unavailable", code },
          });
          return;
        }
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
      const signature = req.headers["stripe-signature"] as string;
      if (!signature) {
        res.status(400).json({ error: "Missing stripe-signature header" });
        return;
      }

      const rawBody = req.rawBody;
      if (!rawBody) {
        res.status(500).json({ error: "Raw body not available for signature verification" });
        return;
      }

      const event = verifyWebhookSignature(rawBody, signature);
      console.log(`[Onramp] Webhook received — type=${event.type}, id=${event.id}`);

      // Crypto onramp event types are not yet in the official Stripe TS definitions (public preview)
      if ((event.type as string) === "crypto.onramp_session.updated") {
        handleSessionUpdate((event.data as any).object);
      }

      res.json({ received: true });
    } catch (error: any) {
      if (error.type === "StripeSignatureVerificationError") {
        console.warn(`[Onramp] Invalid webhook signature`);
        res.status(400).json({ error: "Invalid webhook signature" });
        return;
      }
      next(error);
    }
  }

  static async getTransactions(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userAddress = req.address;
      const transactions = await getUserTransactions(userAddress);
      res.json({ success: true, data: { transactions } });
    } catch (error: any) {
      next(error);
    }
  }
}

export default OnrampController;
