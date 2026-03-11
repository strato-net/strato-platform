import { Router } from "express";
import authHandler from "../middleware/authHandler";
import MetalForgeController from "../controllers/metalForge.controller";

const router = Router();

/**
 * @openapi
 * /metal-forge/configs:
 *   get:
 *     summary: Get MetalForge on-chain configurations
 *     description: Returns configured metals (with mint caps) and supported payment tokens (with fees) from the MetalForge contract
 *     tags: [MetalForge]
 *     security: []
 *     responses:
 *       200:
 *         description: MetalForge configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 metals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 *                       isEnabled:
 *                         type: boolean
 *                       mintCap:
 *                         type: string
 *                       totalMinted:
 *                         type: string
 *                 payTokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 *                       isEnabled:
 *                         type: boolean
 *                       feeBps:
 *                         type: integer
 */
router.get("/configs", authHandler.authorizeRequest(true), MetalForgeController.getConfigs);

/**
 * @openapi
 * /metal-forge/buy:
 *   post:
 *     summary: Buy metal tokens by paying with a supported token
 *     description: Approves the MetalForge contract to spend the pay token, then calls mintMetal on-chain
 *     tags: [MetalForge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metalToken
 *               - payToken
 *               - payAmount
 *               - minMetalOut
 *             properties:
 *               metalToken:
 *                 type: string
 *                 description: Address of the metal token to mint
 *               payToken:
 *                 type: string
 *                 description: Address of the payment token
 *               payAmount:
 *                 type: string
 *                 description: Payment amount in wei
 *               minMetalOut:
 *                 type: string
 *                 description: Minimum metal output in wei (slippage protection)
 *     responses:
 *       200:
 *         description: Mint transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/buy", authHandler.authorizeRequest(), MetalForgeController.buy);

export default router;
