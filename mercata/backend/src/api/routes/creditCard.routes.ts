import { Router } from "express";
import authHandler from "../middleware/authHandler";
import CreditCardController from "../controllers/creditCard.controller";

const router = Router();

/**
 * @openapi
 * /credit-card/config:
 *   get:
 *     summary: Get crypto credit card config for the authenticated user
 *     tags: [Credit Card]
 *     responses:
 *       200:
 *         description: Config or null
 *       401:
 *         description: Unauthorized
 */
router.get("/config", authHandler.authorizeRequest(), CreditCardController.getConfig);

/**
 * @openapi
 * /credit-card/config:
 *   put:
 *     summary: Create or update crypto credit card config
 *     tags: [Credit Card]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - destinationChainId
 *               - cardWalletAddress
 *               - externalToken
 *               - thresholdAmount
 *               - topUpAmount
 *               - useBorrow
 *               - checkFrequencyMinutes
 *               - cooldownMinutes
 *               - enabled
 *             properties:
 *               destinationChainId: { type: string }
 *               cardWalletAddress: { type: string }
 *               externalToken: { type: string }
 *               thresholdAmount: { type: string }
 *               topUpAmount: { type: string }
 *               useBorrow: { type: boolean }
 *               checkFrequencyMinutes: { type: number }
 *               cooldownMinutes: { type: number }
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated config
 *       401:
 *         description: Unauthorized
 */
router.put("/config", authHandler.authorizeRequest(), CreditCardController.upsertConfig);

/**
 * @openapi
 * /credit-card/approve:
 *   post:
 *     summary: Approve CreditCardTopUp contract to spend USDST for automatic top-ups
 *     tags: [Credit Card]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: string, description: "Wei amount (e.g. max uint256 for unlimited)" }
 *     responses:
 *       200:
 *         description: Transaction submitted
 *       401:
 *         description: Unauthorized
 */
router.post("/approve", authHandler.authorizeRequest(), CreditCardController.approve);

/**
 * @openapi
 * /credit-card/config:
 *   delete:
 *     summary: Remove crypto credit card config
 *     tags: [Credit Card]
 *     responses:
 *       200:
 *         description: { deleted: boolean }
 *       401:
 *         description: Unauthorized
 */
router.delete("/config", authHandler.authorizeRequest(), CreditCardController.deleteConfig);

export default router;
