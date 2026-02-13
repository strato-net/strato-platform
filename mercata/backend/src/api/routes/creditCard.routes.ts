import { Router } from "express";
import authHandler from "../middleware/authHandler";
import CreditCardController from "../controllers/creditCard.controller";

const router = Router();

/**
 * @openapi
 * /credit-card:
 *   get:
 *     summary: Get user's cards from Cirrus (on-chain data, no RPC)
 *     tags: [Credit Card]
 *     responses:
 *       200:
 *         description: Array of card objects (id, nickname, providerId, destinationChainId, externalToken, cardWalletAddress)
 *       401:
 *         description: Unauthorized
 */
router.get("/", authHandler.authorizeRequest(), CreditCardController.getCards);

/**
 * @openapi
 * /credit-card/config:
 *   get:
 *     summary: Get all crypto credit card configs for the authenticated user
 *     tags: [Credit Card]
 *     responses:
 *       200:
 *         description: Array of card configs
 *       401:
 *         description: Unauthorized
 */
router.get("/config", authHandler.authorizeRequest(), CreditCardController.getConfigs);

/**
 * @openapi
 * /credit-card/config/:id/balance:
 *   get:
 *     summary: Get card wallet balance for a config
 *     tags: [Credit Card]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: { balance: string | null } (wei string)
 *       404:
 *         description: Card not found
 */
router.get("/config/:id/balance", authHandler.authorizeRequest(), CreditCardController.getConfigBalance);

/**
 * @openapi
 * /credit-card/balance:
 *   get:
 *     summary: Get card wallet token balance by chain/token/wallet (for on-chain cards)
 *     tags: [Credit Card]
 *     parameters:
 *       - name: destinationChainId
 *         in: query
 *         required: true
 *         schema: { type: string }
 *       - name: externalToken
 *         in: query
 *         required: true
 *         schema: { type: string }
 *       - name: cardWalletAddress
 *         in: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: { balance: string | null } (wei string)
 */
router.get("/balance", authHandler.authorizeRequest(), CreditCardController.getBalanceByParams);

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
 * /credit-card/add-card:
 *   post:
 *     summary: Add a card on-chain (backend submits tx to STRATO)
 *     tags: [Credit Card]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [destinationChainId, externalToken, cardWalletAddress, thresholdAmount, cooldownMinutes, topUpAmount]
 *             properties:
 *               nickname: { type: string }
 *               providerId: { type: string }
 *               destinationChainId: { type: string }
 *               externalToken: { type: string }
 *               cardWalletAddress: { type: string }
 *               thresholdAmount: { type: string, description: "Wei - top up when balance below this" }
 *               cooldownMinutes: { type: number, description: "Cooldown between top-ups (minutes)" }
 *               topUpAmount: { type: string, description: "Wei amount to bridge per top-up" }
 *     responses:
 *       200:
 *         description: { success: true, data: { status, hash } }
 *       401:
 *         description: Unauthorized
 */
router.post("/add-card", authHandler.authorizeRequest(), CreditCardController.addCard);

/**
 * @openapi
 * /credit-card/update-card:
 *   post:
 *     summary: Update a card on-chain (backend submits tx to STRATO)
 *     tags: [Credit Card]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [index, destinationChainId, externalToken, cardWalletAddress, thresholdAmount, cooldownMinutes, topUpAmount]
 *             properties:
 *               index: { type: number }
 *               nickname: { type: string }
 *               providerId: { type: string }
 *               destinationChainId: { type: string }
 *               externalToken: { type: string }
 *               cardWalletAddress: { type: string }
 *               thresholdAmount: { type: string, description: "Wei - top up when balance below" }
 *               cooldownMinutes: { type: number }
 *               topUpAmount: { type: string, description: "Wei amount per top-up" }
 *     responses:
 *       200:
 *         description: { success: true, data: { status, hash } }
 *       401:
 *         description: Unauthorized
 */
router.post("/update-card", authHandler.authorizeRequest(), CreditCardController.updateCard);

/**
 * @openapi
 * /credit-card/remove-card:
 *   post:
 *     summary: Remove a card on-chain (backend submits tx to STRATO)
 *     tags: [Credit Card]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [index]
 *             properties:
 *               index: { type: number }
 *     responses:
 *       200:
 *         description: { success: true, data: { status, hash } }
 *       401:
 *         description: Unauthorized
 */
router.post("/remove-card", authHandler.authorizeRequest(), CreditCardController.removeCard);

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
 * /credit-card/config/:id:
 *   delete:
 *     summary: Remove a crypto credit card config
 *     tags: [Credit Card]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: { deleted: boolean }
 *       401:
 *         description: Unauthorized
 */
router.delete("/config/:id", authHandler.authorizeRequest(), CreditCardController.deleteConfig);

/**
 * list of enabled card configs for the top-up watcher service.
 */
router.get("/watcher-config", authHandler.authorizeRequest(), CreditCardController.getWatcherConfig);

/**
 * execute a single top-up (CreditCardTopUp.topUpCard) and mark config lastTopUpAt.
 */
router.post("/execute-top-up", authHandler.authorizeRequest(), CreditCardController.executeTopUp);

/**
 * User-triggered manual top-up for a specific card (uses operator service token under the hood).
 */
router.post("/manual-top-up", authHandler.authorizeRequest(), CreditCardController.manualTopUp);

export default router;
