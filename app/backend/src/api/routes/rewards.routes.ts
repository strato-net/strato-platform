import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsController from "../controllers/rewards.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });
const userRewardsAuth = authHandler.authorizeRequest({ allowWalletAuth: true, allowAnonAccess: false });

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
 * /rewards/activities/me:
 *   get:
 *     summary: Get all activities with user-specific data for the authenticated user
 *     tags: [Rewards]
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
router.get("/activities/me", userRewardsAuth, RewardsController.getMyActivities);

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
router.post("/claim-all", walletAuth, RewardsController.claimAllRewards);

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
router.post("/claim/:activityId", walletAuth, RewardsController.claimActivityRewards);

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

/**
 * @openapi
 * /rewards/leaderboard/me:
 *   get:
 *     summary: Get the current user's rank on the leaderboard
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: User rank response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rank:
 *                   type: integer
 *                   nullable: true
 *                   description: User's rank (1-based), null if not on leaderboard
 *                 totalRewardsEarned:
 *                   type: string
 *                   nullable: true
 *                   description: Total rewards earned by the user
 *                 total:
 *                   type: integer
 *                   description: Total number of users on the leaderboard
 *       401:
 *         description: Unauthorized
 */
router.get("/leaderboard/me", userRewardsAuth, RewardsController.getMyRank);

export default router;
