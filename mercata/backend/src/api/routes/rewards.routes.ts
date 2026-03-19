import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsController from "../controllers/rewards.controller";

const router = Router();

// ═════════════════════════════════════════════════════════════════════════
// REWARDS CONTRACT ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /rewards/overview:
 *   get:
 *     summary: Get global Rewards contract overview data
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Rewards overview data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rewardToken:
 *                   type: string
 *                   description: Address of the reward token (CATA)
 *                   example: "2680dc6693021cd3fefb84351570874fbef8332a"
 *                 totalRewardsEmission:
 *                   type: string
 *                   description: Total emission rate across all activities (points per second)
 *                   example: "1000000000000000000"
 *                 lastBlockHandled:
 *                   type: string
 *                   description: Highest block number seen (for monitoring)
 *                   example: "12345"
 *                 activityIds:
 *                   type: array
 *                   items:
 *                     type: integer
 *                   description: Array of all activity IDs
 *                   example: [1, 2, 3]
 *       401:
 *         description: Unauthorized
 */
router.get("/overview", authHandler.authorizeRequest(true), RewardsController.getOverview);

/**
 * @openapi
 * /rewards/activities:
 *   get:
 *     summary: Get all activities in the system (without user-specific data)
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: List of all activities
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   activityId:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   activityType:
 *                     type: integer
 *                   emissionRate:
 *                     type: string
 *                   accRewardPerStake:
 *                     type: string
 *                   lastUpdateTime:
 *                     type: string
 *                   totalStake:
 *                     type: string
 *                   sourceContract:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
router.get("/activities", authHandler.authorizeRequest(true), RewardsController.getAllActivities);

/**
 * @openapi
 * /rewards/activities/{userAddress}:
 *   get:
 *     summary: Get all activities with user-specific data for the specified user
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: userAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The user address to fetch activities for
 *         example: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
 *     responses:
 *       200:
 *         description: Activities with user-specific data and rewards breakdown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unclaimedRewards:
 *                   type: string
 *                   description: Total unclaimed rewards in wei (claimable now)
 *                   example: "5000000000000000000"
 *                 claimedRewards:
 *                   type: string
 *                   description: Total claimed rewards in wei (from RewardsClaimed events)
 *                   example: "10000000000000000000"
 *                 activities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       activityId:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       activityType:
 *                         type: integer
 *                       emissionRate:
 *                         type: string
 *                       accRewardPerStake:
 *                         type: string
 *                       lastUpdateTime:
 *                         type: string
 *                       totalStake:
 *                         type: string
 *                       sourceContract:
 *                         type: string
 *                       userInfo:
 *                         type: object
 *                         properties:
 *                           stake:
 *                             type: string
 *                           userIndex:
 *                             type: string
 *                       personalEmissionRate:
 *                         type: string
 *       400:
 *         description: Invalid user address
 *       401:
 *         description: Unauthorized
 */
router.get("/activities/:userAddress", authHandler.authorizeRequest(), RewardsController.getUserActivities);

/**
 * @openapi
 * /rewards/claim-all:
 *   post:
 *     summary: Claim all rewards from all activities
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Claim transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 txHash:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post("/claim-all", authHandler.authorizeRequest(), RewardsController.claimAllRewards);

/**
 * @openapi
 * /rewards/claim/{activityId}:
 *   post:
 *     summary: Claim rewards for a specific activity
 *     tags: [Rewards]
 *     parameters:
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The activity ID to claim rewards from
 *         example: 1
 *     responses:
 *       200:
 *         description: Claim transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 txHash:
 *                   type: string
 *       400:
 *         description: Invalid activity ID
 *       401:
 *         description: Unauthorized
 */
router.post("/claim/:activityId", authHandler.authorizeRequest(), RewardsController.claimActivityRewards);

/**
 * @openapi
 * /rewards/leaderboard:
 *   get:
 *     summary: Get leaderboard of top reward earners
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of entries to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *         description: Number of entries to skip
 *     responses:
 *       200:
 *         description: Leaderboard response with entries and pagination info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       address:
 *                         type: string
 *                       totalRewardsEarned:
 *                         type: string
 *                         description: Total rewards earned (unclaimed + pending rewards)
 *                 total:
 *                   type: integer
 *                   description: Total number of entries available
 *                 offset:
 *                   type: integer
 *                   description: Current offset
 *                 limit:
 *                   type: integer
 *                   description: Current limit
 *       401:
 *         description: Unauthorized
 */
router.get("/leaderboard", authHandler.authorizeRequest(true), RewardsController.getLeaderboard);

export default router;
