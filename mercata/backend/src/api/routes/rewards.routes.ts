import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsChefController from "../controllers/rewardsChef.controller";
import RewardsController from "../controllers/rewards.controller";

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

/**
 * @openapi
 * /rewards/state:
 *   get:
 *     summary: Get RewardsChef global state
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: RewardsChef global state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cataPerSecond:
 *                   type: string
 *                   description: CATA tokens emitted per second
 *                   example: "1000000000000000000"
 *                 totalAllocPoint:
 *                   type: string
 *                   description: Total allocation points across all pools
 *                   example: "1000"
 *       404:
 *         description: RewardsChef state not found
 *       401:
 *         description: Unauthorized
 */
router.get("/state", authHandler.authorizeRequest(), RewardsChefController.getState);

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
 *                 totalDistributed:
 *                   type: string
 *                   description: Sum of all users' total earned rewards (unclaimed + pending + claimed)
 *                   example: "5000000000000000000000"
 *                 currentSeason:
 *                   type: integer
 *                   description: Current season number
 *                   example: 1
 *                 seasonName:
 *                   type: string
 *                   description: Current season name from SeasonAnnouncement event
 *                   example: "Season 1"
 *       401:
 *         description: Unauthorized
 */
router.get("/overview", authHandler.authorizeRequest(), RewardsController.getOverview);

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
router.get("/activities", authHandler.authorizeRequest(), RewardsController.getAllActivities);

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
 *       - in: query
 *         name: season
 *         schema:
 *           type: boolean
 *           default: false
 *         description: If true, returns season leaderboard data (dummy data for now)
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
 *                 currentSeason:
 *                   type: integer
 *                   description: Current season number
 *                 seasonName:
 *                   type: string
 *                   description: Current season name
 *       401:
 *         description: Unauthorized
 */
router.get("/leaderboard", authHandler.authorizeRequest(), RewardsController.getLeaderboard);

export default router;
