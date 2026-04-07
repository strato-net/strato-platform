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
 *               - tokens
 *               - amounts
 *               - ephemeralAddress
 *               - expiry
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of token contract addresses (with or without 0x prefix)
 *               amounts:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of amounts in wei (as strings to avoid overflow)
 *               ephemeralAddress:
 *                 type: string
 *                 description: Ephemeral address for the recipient (with or without 0x prefix)
             *               expiry:
             *                 type: number
             *                 description: Expiry time in seconds from now (e.g., 604800 for 7 days)
             *               quantity:
             *                 type: number
             *                 description: Number of referrals this deposit supports (must be a positive integer)
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

/**
 * @openapi
 * /refer/referrals:
 *   get:
 *     summary: Get all active referrals for the current user
 *     tags: [Refer]
 *     responses:
 *       200:
 *         description: List of active referrals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       ephemeralAddress:
 *                         type: string
 *                       sender:
 *                         type: string
 *                       tokens:
 *                         type: array
 *                         items:
 *                           type: string
 *                       amounts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       expiry:
 *                         type: number
 */
router.get("/referrals", authHandler.authorizeRequest(), ReferController.getReferrals);

/**
 * @openapi
 * /refer/cancel:
 *   post:
 *     summary: Cancel an expired referral deposit
 *     tags: [Refer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ephemeralAddress
 *             properties:
 *               ephemeralAddress:
 *                 type: string
 *                 description: Ephemeral address of the deposit to cancel (with or without 0x prefix)
 *     responses:
 *       200:
 *         description: Cancellation transaction submitted successfully
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
 *       400:
 *         description: Invalid request parameters
 *       403:
 *         description: Deposit not eligible for cancellation (not expired or not owned by user)
 */
router.post("/cancel", authHandler.authorizeRequest(), ReferController.cancel);

/**
 * @openapi
 * /refer/history:
 *   get:
 *     summary: Get referral history (Redeemed and Cancelled events)
 *     tags: [Refer]
 *     responses:
 *       200:
 *         description: Referral history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       eventName:
 *                         type: string
 *                       ephemeralAddress:
 *                         type: string
 *                       tokens:
 *                         type: array
 *                         items:
 *                           type: string
 *                       amounts:
 *                         type: array
 *                         items:
 *                           type: string
 *                       sender:
 *                         type: string
 *                       recipient:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       blockTimestamp:
 *                         type: string
 *                         format: date-time
 */
router.get("/history", authHandler.authorizeRequest(), ReferController.getHistory);

/**
 * @openapi
 * /refer/status:
 *   get:
 *     summary: Get referral status (active, redeemed, or cancelled)
 *     tags: [Refer]
 *     parameters:
 *       - name: ephemeralAddress
 *         in: query
 *         required: true
 *         description: Ephemeral address (with or without 0x prefix)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Referral status retrieved successfully
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
 *                       enum: [active, redeemed, cancelled]
 *                     eventName:
 *                       type: string
 *                       nullable: true
 *                     blockTimestamp:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *       400:
 *         description: Invalid ephemeral address
 */
router.get("/status", authHandler.authorizeRequest(), ReferController.getStatus);

export default router;

