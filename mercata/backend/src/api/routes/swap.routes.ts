import { Router } from "express";
import authHandler from "../middleware/authHandler";
import SwappingController from "../controllers/swapping.controller";

const router = Router();

/**
 * @openapi
 * /swap-pools:
 *   get:
 *     summary: Get all swap pools
 *     tags: [Swap]
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
 *   post:
 *     summary: Create new swap pool
 *     tags: [Swap]
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
router.get("/swap-pools", authHandler.authorizeRequest(true), SwappingController.getAll);
router.post("/swap-pools", authHandler.authorizeRequest(), SwappingController.create);

/**
 * @openapi
 * /swap-pools/tokens:
 *   get:
 *     summary: Get all swappable tokens
 *     tags: [Swap]
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
router.get("/swap-pools/tokens", authHandler.authorizeRequest(), SwappingController.getSwapableTokens);

/**
 * @openapi
 * /swap-pools/tokens/{tokenAddress}:
 *   get:
 *     summary: Get swappable token pairs
 *     tags: [Swap]
 *     parameters:
 *       - name: tokenAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Token address
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
router.get("/swap-pools/tokens/:tokenAddress", authHandler.authorizeRequest(), SwappingController.getSwapableTokenPairs);

/**
 * @openapi
 * /swap-pools/positions:
 *   get:
 *     summary: Get user LP token positions
 *     tags: [Swap]
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
router.get("/swap-pools/positions", authHandler.authorizeRequest(), SwappingController.getUserLiquidityPools);

/**
 * @openapi
 * /swap-pools/{tokenAddress1}/{tokenAddress2}:
 *   get:
 *     summary: Get pool by token pair
 *     tags: [Swap]
 *     parameters:
 *       - name: tokenAddress1
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: First token address
 *       - name: tokenAddress2
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Second token address
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
router.get("/swap-pools/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);

/**
 * @openapi
 * /swap-pools/{poolAddress}:
 *   get:
 *     summary: Get pool by address
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Pool address
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
router.get("/swap-pools/:poolAddress", authHandler.authorizeRequest(true), SwappingController.get);

/**
 * @openapi
 * /swap-pools/{poolAddress}/liquidity:
 *   post:
 *     summary: Add liquidity (dual token)
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Pool address
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
 *   delete:
 *     summary: Remove liquidity from pool
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Pool address
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
router.post("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.addLiquidityDualToken);
router.delete("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.removeLiquidity);

/**
 * @openapi
 * /swap-pools/{poolAddress}/liquidity/single:
 *   post:
 *     summary: Add liquidity (single token)
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Pool address
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
router.post("/swap-pools/:poolAddress/liquidity/single", authHandler.authorizeRequest(), SwappingController.addLiquiditySingleToken);

/**
 * @openapi
 * /swap:
 *   post:
 *     summary: Execute token swap
 *     tags: [Swap]
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
router.post("/swap", authHandler.authorizeRequest(), SwappingController.swap);

/**
 * @openapi
 * /swap-history/{poolAddress}:
 *   get:
 *     summary: Get swap history for a pool
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Pool address
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
router.get("/swap-history/:poolAddress", authHandler.authorizeRequest(true), SwappingController.getSwapHistory);

/**
 * @openapi
 * /swap-pools/set-rates:
 *   post:
 *     summary: Set pool rates (admin)
 *     tags: [Swap]
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
router.post("/swap-pools/set-rates", authHandler.authorizeRequest(), SwappingController.setPoolRates);

export default router;
