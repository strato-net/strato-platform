import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsChefController from "../controllers/rewardsChef.controller";

const router = Router();

/**
 * @openapi
 * /rewards/pending:
 *   get:
 *     summary: Get pending CATA rewards for the authenticated user across all pools
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Pending CATA rewards
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userAddress:
 *                   type: string
 *                   description: The user's address
 *                   example: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
 *                 pendingCata:
 *                   type: string
 *                   description: Total pending CATA rewards in wei (raw value)
 *                   example: "1000000000000000000"
 *                 pendingCataFormatted:
 *                   type: string
 *                   description: Total pending CATA rewards formatted with 2 decimals
 *                   example: "1.00"
 *       401:
 *         description: Unauthorized
 */
router.get("/pending", authHandler.authorizeRequest(), RewardsChefController.getPendingRewards);

/**
 * @openapi
 * /rewards/claim:
 *   post:
 *     summary: Claim all pending CATA rewards from all pools
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Claim transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Transaction status
 *                   example: "success"
 *                 hash:
 *                   type: string
 *                   description: Transaction hash
 *                   example: "0x123abc..."
 *       401:
 *         description: Unauthorized
 */
router.post("/claim", authHandler.authorizeRequest(), RewardsChefController.claimRewards);

/**
 * @openapi
 * /rewards/pools/{poolId}/balance:
 *   get:
 *     summary: Get user's staked balance in a specific RewardsChef pool
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: poolId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The pool ID to query
 *         example: 0
 *     responses:
 *       200:
 *         description: User's staked balance in the pool
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 poolId:
 *                   type: integer
 *                   description: The pool ID
 *                   example: 0
 *                 stakedBalance:
 *                   type: string
 *                   description: Staked balance in wei (raw value)
 *                   example: "1000000000000000000"
 *                 stakedBalanceFormatted:
 *                   type: string
 *                   description: Staked balance formatted with 2 decimals
 *                   example: "1.00"
 *       400:
 *         description: Invalid pool ID
 *       401:
 *         description: Unauthorized
 */
router.get("/pools/:poolId/balance", authHandler.authorizeRequest(), RewardsChefController.getStakedBalanceForPool);

/**
 * @openapi
 * /rewards/pools:
 *   get:
 *     summary: Get all RewardsChef pools
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: List of all pools in RewardsChef
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pools:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       poolIdx:
 *                         type: integer
 *                         description: Pool index
 *                         example: 0
 *                       lpToken:
 *                         type: string
 *                         description: LP token address for this pool
 *                         example: "0x1234567890abcdef1234567890abcdef12345678"
 *                       allocPoint:
 *                         type: string
 *                         description: Allocation points for this pool
 *                         example: "100"
 *                       accPerToken:
 *                         type: string
 *                         description: Accumulated rewards per token
 *                         example: "1000000000000000000"
 *                       lastRewardTimestamp:
 *                         type: string
 *                         description: Last timestamp when rewards were calculated
 *                         example: "1640000000"
 *       401:
 *         description: Unauthorized
 */
router.get("/pools", authHandler.authorizeRequest(), RewardsChefController.getPools);

/**
 * @openapi
 * /rewards/pools/by-lp-token/{lpTokenAddress}:
 *   get:
 *     summary: Find RewardsChef pool by LP token address
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: lpTokenAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The LP token address to search for
 *         example: "0x1234567890abcdef1234567890abcdef12345678"
 *     responses:
 *       200:
 *         description: Pool found for the LP token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pool:
 *                   type: object
 *                   properties:
 *                     poolIdx:
 *                       type: integer
 *                       description: Pool index
 *                       example: 0
 *                     lpToken:
 *                       type: string
 *                       description: LP token address for this pool
 *                       example: "0x1234567890abcdef1234567890abcdef12345678"
 *                     allocPoint:
 *                       type: string
 *                       description: Allocation points for this pool
 *                       example: "100"
 *                     accPerToken:
 *                       type: string
 *                       description: Accumulated rewards per token
 *                       example: "1000000000000000000"
 *                     lastRewardTimestamp:
 *                       type: string
 *                       description: Last timestamp when rewards were calculated
 *                       example: "1640000000"
 *       404:
 *         description: Pool not found for the given LP token address
 *       401:
 *         description: Unauthorized
 */
router.get("/pools/by-lp-token/:lpTokenAddress", authHandler.authorizeRequest(), RewardsChefController.findPoolByLpToken);

export default router;
