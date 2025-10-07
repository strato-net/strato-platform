import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeController from "../controllers/bridge.controller";

const router = Router();

/**
 * @openapi
 * /bridge/bridgeOut:
 *   post:
 *     summary: Bridge tokens out
 *     tags: [Bridge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [externalChainId, stratoToken, stratoTokenAmount, externalRecipient]
 *             properties:
 *               externalChainId: { type: string, description: "External chain ID" }
 *               stratoToken: { type: string, description: "STRATO token address" }
 *               stratoTokenAmount: { type: string, description: "Amount to bridge" }
 *               externalRecipient: { type: string, description: "Recipient address on external chain" }
 *               targetStratoToken: { type: string, description: "Target STRATO token (optional)" }
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.post("/bridgeOut", authHandler.authorizeRequest(), BridgeController.bridgeOut);

/**
 * @openapi
 * /bridge/redeemOut:
 *   post:
 *     summary: Redeem bridged tokens
 *     tags: [Bridge]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.post("/redeemOut", authHandler.authorizeRequest(), BridgeController.redeemOut);

/**
 * @openapi
 * /bridge/bridgeableTokens/{chainId}:
 *   get:
 *     summary: Get bridgeable tokens for chain
 *     tags: [Bridge]
 *     parameters:
 *       - name: chainId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/bridgeableTokens/:chainId", authHandler.authorizeRequest(false), BridgeController.getBridgeableTokens);

/**
 * @openapi
 * /bridge/redeemableTokens/{chainId}:
 *   get:
 *     summary: Get redeemable tokens for chain
 *     tags: [Bridge]
 *     parameters:
 *       - name: chainId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/redeemableTokens/:chainId", authHandler.authorizeRequest(false), BridgeController.getRedeemableTokens);

/**
 * @openapi
 * /bridge/networkConfigs:
 *   get:
 *     summary: Get network configurations
 *     tags: [Bridge]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get("/networkConfigs", authHandler.authorizeRequest(false), BridgeController.getNetworkConfigs);

/**
 * @openapi
 * /bridge/transactions/{type}:
 *   get:
 *     summary: Get bridge transactions
 *     tags: [Bridge]
 *     parameters:
 *       - name: type
 *         in: path
 *         required: true
 *         schema: { type: string, enum: [withdrawal, deposit] }
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/transactions/:type", authHandler.authorizeRequest(), BridgeController.getTransactions);

export default router;
