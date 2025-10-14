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

export default router;
