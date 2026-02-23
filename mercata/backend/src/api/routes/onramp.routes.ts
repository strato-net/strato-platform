import { Router } from "express";
import authHandler from "../middleware/authHandler";
import OnrampController from "../controllers/onramp.controller";

const router = Router();

/**
 * @openapi
 * /onramp/session:
 *   post:
 *     summary: Create a Stripe crypto onramp session
 *     description: Creates a new onramp session with Stripe and returns the client secret for embedding the widget.
 *     tags: [Onramp]
 *     responses:
 *       200:
 *         description: Onramp session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     clientSecret:
 *                       type: string
 *       400:
 *         description: Onramp unavailable for this customer (geo restriction)
 *       503:
 *         description: Onramp temporarily disabled by Stripe
 */
router.post("/session", authHandler.authorizeRequest(), OnrampController.createSession);

/**
 * @openapi
 * /onramp/webhook:
 *   post:
 *     summary: Stripe onramp webhook endpoint
 *     description: Receives session status updates from Stripe. Verified via Stripe-Signature header (no auth middleware).
 *     tags: [Onramp]
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook acknowledged
 *       400:
 *         description: Invalid signature or missing header
 */
router.post("/webhook", OnrampController.handleWebhook);

/**
 * @openapi
 * /onramp/transactions:
 *   get:
 *     summary: Get onramp transaction history
 *     description: Returns the authenticated user's onramp transaction history.
 *     tags: [Onramp]
 *     responses:
 *       200:
 *         description: Transaction history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           stripeSessionId:
 *                             type: string
 *                           status:
 *                             type: string
 *                           destinationCurrency:
 *                             type: string
 *                           destinationNetwork:
 *                             type: string
 *                           destinationAmount:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           completedAt:
 *                             type: string
 *                             format: date-time
 */
router.get("/transactions", authHandler.authorizeRequest(), OnrampController.getTransactions);

export default router;
