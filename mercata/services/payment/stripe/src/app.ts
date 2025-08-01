import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { Request, Response } from "express";
// import { handleStripeWebhook } from "./api/services/onramp.service";
import { stripe } from "./utils/stripeClient";
import { stripeWebhookKey } from "./config/config";
import { initOpenIdConfig } from "./config/config";
import { recoverPendingSessions } from "./api/services/onramp.service";

const PORT = process.env.PORT || 3002;

const app = express();

// app.post(
//   "/webhook",
//   express.raw({ type: "application/json" }),
//   (request: Request, response: Response) => {
//     // console.log("=== WEBHOOK ENDPOINT HIT ===");

//     let event: any;
//     const signature = request.headers["stripe-signature"] as string;
    
//   try {
//     event = stripe.webhooks.constructEvent(
//       request.body,
//       signature,
//       stripeWebhookKey
//     );
//   } catch (err: any) {
//     console.error("Webhook signature verification failed.", err.message);
//     response.sendStatus(400);
//     return;
//   }
    
//   try {
//     event = JSON.parse(request.body.toString());
//   } catch (err) {
//     console.error("Failed to parse request body:", err);
//     response.sendStatus(400);
//     return;
//   }
//   console.log("Parsed event:", JSON.stringify(event, null, 2));
//   switch (event.type) {
//     case "checkout.session.completed":
//       const paymentIntent = event.data.object;
//       handleStripeWebhook(paymentIntent).then(() => {
//         console.log("PaymentIntent was successful!");
//       });
//       break;
//     default:
//       console.log(`Unhandled event type ${event.type}`);
//   }

//   response.sendStatus(200);
//   return;
//   }
// );

app.use(cors(), express.json(), express.urlencoded({ extended: true }));

app.use("/", routes);

(async () => {
  try {
    await initOpenIdConfig();
    
    // Recover any pending sessions from database after restart
    console.log('Recovering pending sessions...');
    await recoverPendingSessions();
    
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
})();

export default app;
