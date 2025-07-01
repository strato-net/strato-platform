import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { checkout, handleStripeWebhook } from "../services/onramp.service";

class OnRampController {
  static async checkout(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { token, buyerAddress, baseUrl, amount } = req.body;

      const result = await checkout(token, buyerAddress, amount, baseUrl);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // static async stripeWebhook(
  //   req: Request,
  //   res: Response,
  //   next: NextFunction
  // ): Promise<void> {
  //   console.log("=== WEBHOOK ENDPOINT HIT ===");
  //   console.log("Headers:", req.headers);
  //   console.log("Body type:", typeof req.body);
  //   console.log("Body:", req.body);
    
  //   try {
  //     // Extract the session from the Stripe event
  //     const event = req.body;
  //     if (event.type === 'checkout.session.completed') {
  //       await handleStripeWebhook(event.data.object);
  //     }
  //     res.status(200).send("ok");
  //   } catch (error) {
  //     console.error("Webhook error:", error);
  //     next(error);
  //   }
  // }
}

export default OnRampController;