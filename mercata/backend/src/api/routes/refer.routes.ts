import { Router } from "express";
import authHandler from "../middleware/authHandler";
import ReferController from "../controllers/refer.controller";

const router = Router();

/**
 * @openapi
 * /refer/deposit:
 *   post:
 *     summary: Deposit tokens to escrow for referral
 *     tags: [Refer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenAddress
 *               - amount
 *               - ephemeralAddress
 *               - escrowContractAddress
 *             properties:
 *               tokenAddress:
 *                 type: string
 *                 description: Token contract address (with or without 0x prefix)
 *               amount:
 *                 type: string
 *                 description: Amount in wei (as string to avoid overflow)
 *               ephemeralAddress:
 *                 type: string
 *                 description: Ephemeral address for the recipient (with or without 0x prefix)
 *               escrowContractAddress:
 *                 type: string
 *                 description: Escrow contract address (with or without 0x prefix)
 *     responses:
 *       200:
 *         description: Deposit transaction submitted successfully
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
 *                     status:
 *                       type: string
 *                     hash:
 *                       type: string
 */
router.post("/deposit", authHandler.authorizeRequest(), ReferController.deposit);

/**
 * @openapi
 * /refer/deposit:
 *   get:
 *     summary: Get escrow deposit information
 *     tags: [Refer]
 *     parameters:
 *       - name: ephemeralAddress
 *         in: query
 *         required: true
 *         description: Ephemeral address (with or without 0x prefix)
 *         schema:
 *           type: string
 *       - name: tokenAddress
 *         in: query
 *         required: true
 *         description: Token contract address (with or without 0x prefix)
 *         schema:
 *           type: string
 *       - name: escrowContractAddress
 *         in: query
 *         required: true
 *         description: Escrow contract address (with or without 0x prefix)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deposit information retrieved successfully
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
 *                     sender:
 *                       type: string
 *                     token:
 *                       type: string
 *                     amount:
 *                       type: string
 *                     redeemed:
 *                       type: boolean
 *       404:
 *         description: Deposit not found
 */
router.get("/deposit", authHandler.authorizeRequest(false), ReferController.getDeposit);

/**
 * @openapi
 * /refer/redeem:
 *   post:
 *     summary: Redeem escrow deposit
 *     tags: [Refer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - r
 *               - s
 *               - v
 *               - recipientAddress
 *             properties:
 *               r:
 *                 type: string
 *                 description: r component of signature (hex string)
 *               s:
 *                 type: string
 *                 description: s component of signature (hex string)
 *               v:
 *                 type: number
 *                 description: v component of signature (recovery id, 27 or 28)
 *               recipientAddress:
 *                 type: string
 *                 description: Recipient address (with or without 0x prefix)
 *     responses:
 *       200:
 *         description: Redemption request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Redemption server error or misconfiguration
 */
router.post("/redeem", authHandler.authorizeRequest(), ReferController.redeem);

export default router;

