import { Router } from "express";
import authHandler from "../middleware/authHandler";
import OnrampV2Controller from "../controllers/onramp.v2.controller";

const router = Router();

/**
 * @openapi
 * /onramp/v2/quote:
 *   post:
 *     summary: Get Meld crypto purchase quotes
 *     description: Returns quotes from multiple onramp providers via the Meld API.
 *     tags: [Onramp V2]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceAmount, sourceCurrencyCode, destinationCurrencyCode, countryCode]
 *             properties:
 *               sourceAmount:
 *                 type: string
 *               sourceCurrencyCode:
 *                 type: string
 *               destinationCurrencyCode:
 *                 type: string
 *               countryCode:
 *                 type: string
 *               paymentMethodType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Quotes from available providers
 */
router.post("/quote", authHandler.authorizeRequest(), OnrampV2Controller.getQuote);

/**
 * @openapi
 * /onramp/v2/session:
 *   post:
 *     summary: Create a Meld onramp widget session
 *     description: Creates a widget session and returns the provider URL for the user to complete the purchase.
 *     tags: [Onramp V2]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [countryCode, sourceCurrencyCode, sourceAmount, destinationCurrencyCode, serviceProvider]
 *             properties:
 *               countryCode:
 *                 type: string
 *               sourceCurrencyCode:
 *                 type: string
 *               sourceAmount:
 *                 type: string
 *               destinationCurrencyCode:
 *                 type: string
 *               serviceProvider:
 *                 type: string
 *               paymentMethodType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session created with provider widget URL
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
 *                     widgetUrl:
 *                       type: string
 *                     sessionId:
 *                       type: string
 */
router.post("/session", authHandler.authorizeRequest(), OnrampV2Controller.createSession);

/**
 * @openapi
 * /onramp/v2/webhook:
 *   post:
 *     summary: Meld onramp webhook endpoint
 *     description: Receives transaction updates from Meld. Verified via HMAC signature (no auth middleware).
 *     tags: [Onramp V2]
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook acknowledged
 *       400:
 *         description: Invalid signature or missing header
 */
router.post("/webhook", OnrampV2Controller.handleWebhook);

/**
 * @openapi
 * /onramp/v2/deposit-status:
 *   get:
 *     summary: Check bridge deposit status by external tx hash
 *     tags: [Onramp V2]
 *     parameters:
 *       - name: txHash
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deposit status (pending, initiated, or completed)
 */
router.get("/deposit-status", authHandler.authorizeRequest(), OnrampV2Controller.depositStatus);

/**
 * @openapi
 * /onramp/v2/transactions:
 *   get:
 *     summary: Get onramp transaction history
 *     description: Returns the authenticated user's onramp transaction history.
 *     tags: [Onramp V2]
 *     responses:
 *       200:
 *         description: Transaction history
 */
router.get("/transactions", authHandler.authorizeRequest(), OnrampV2Controller.getTransactions);

export default router;
