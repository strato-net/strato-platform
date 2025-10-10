import { Router } from "express";
import authHandler from "../middleware/authHandler";
import SwappingController from "../controllers/swapping.controller";

const router = Router();

/**
 * @openapi
 * /swap-pools:
 *   get:
 *     summary: List available swap pools
 *     tags: [Swap]
 *     parameters:
 *       - name: select
 *         in: query
 *         required: false
 *         description: Optional field projection forwarded to Cirrus
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Maximum number of pools to return
 *         schema:
 *           type: string
 *       - name: offset
 *         in: query
 *         required: false
 *         description: Number of pools to skip
 *         schema:
 *           type: string
 *       - name: order
 *         in: query
 *         required: false
 *         description: Sort order clause
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Swap pool list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 *   post:
 *     summary: Create a new swap pool
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenA
 *               - tokenB
 *             properties:
 *               tokenA:
 *                 type: string
 *                 description: Address of token A
 *               tokenB:
 *                 type: string
 *                 description: Address of token B
 *     responses:
 *       200:
 *         description: Pool creation transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/swap-pools", authHandler.authorizeRequest(true), SwappingController.getAll);
router.post("/swap-pools", authHandler.authorizeRequest(), SwappingController.create);

/**
 * @openapi
 * /swap-pools/tokens:
 *   get:
 *     summary: List tokens that can be swapped
 *     tags: [Swap]
 *     responses:
 *       200:
 *         description: Swappable token list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/swap-pools/tokens", authHandler.authorizeRequest(), SwappingController.getSwapableTokens);

/**
 * @openapi
 * /swap-pools/tokens/{tokenAddress}:
 *   get:
 *     summary: List counterparties for a token
 *     tags: [Swap]
 *     parameters:
 *       - name: tokenAddress
 *         in: path
 *         required: true
 *         description: Token contract address
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token pair list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/swap-pools/tokens/:tokenAddress", authHandler.authorizeRequest(), SwappingController.getSwapableTokenPairs);

/**
 * @openapi
 * /swap-pools/positions:
 *   get:
 *     summary: List user LP token positions
 *     tags: [Swap]
 *     responses:
 *       200:
 *         description: Liquidity positions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/swap-pools/positions", authHandler.authorizeRequest(), SwappingController.getUserLiquidityPools);

/**
 * @openapi
 * /swap-pools/{tokenAddress1}/{tokenAddress2}:
 *   get:
 *     summary: Fetch pools for a token pair
 *     tags: [Swap]
 *     parameters:
 *       - name: tokenAddress1
 *         in: path
 *         required: true
 *         description: Address of the first token
 *         schema:
 *           type: string
 *       - name: tokenAddress2
 *         in: path
 *         required: true
 *         description: Address of the second token
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Matching pools
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/swap-pools/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);

/**
 * @openapi
 * /swap-pools/{poolAddress}:
 *   get:
 *     summary: Fetch a swap pool by address
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         description: Pool contract address
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pool information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/swap-pools/:poolAddress", authHandler.authorizeRequest(true), SwappingController.get);

/**
 * @openapi
 * /swap-pools/{poolAddress}/liquidity:
 *   post:
 *     summary: Add liquidity with both tokens
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         description: Pool contract address
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenBAmount
 *               - maxTokenAAmount
 *             properties:
 *               tokenBAmount:
 *                 type: string
 *                 description: Amount of token B to deposit (decimal string)
 *               maxTokenAAmount:
 *                 type: string
 *                 description: Maximum token A amount to pair (decimal string)
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   delete:
 *     summary: Remove liquidity from the pool
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         description: Pool contract address
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lpTokenAmount
 *             properties:
 *               lpTokenAmount:
 *                 type: string
 *                 description: LP token amount to redeem (decimal string)
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.addLiquidityDualToken);
router.delete("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.removeLiquidity);

/**
 * @openapi
 * /swap-pools/{poolAddress}/liquidity/single:
 *   post:
 *     summary: Add liquidity using a single token
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         description: Pool contract address
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - singleTokenAmount
 *               - isAToB
 *             properties:
 *               singleTokenAmount:
 *                 type: string
 *                 description: Amount of the input token (decimal string)
 *               isAToB:
 *                 type: boolean
 *                 description: Direction of the deposit (true for token A to B)
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/:poolAddress/liquidity/single", authHandler.authorizeRequest(), SwappingController.addLiquiditySingleToken);

/**
 * @openapi
 * /swap:
 *   post:
 *     summary: Execute a token swap
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - isAToB
 *               - amountIn
 *               - minAmountOut
 *             properties:
 *               poolAddress:
 *                 type: string
 *               isAToB:
 *                 type: boolean
 *               amountIn:
 *                 type: string
 *                 description: Input token amount (decimal string)
 *               minAmountOut:
 *                 type: string
 *                 description: Minimum acceptable output (decimal string)
 *     responses:
 *       200:
 *         description: Swap transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap", authHandler.authorizeRequest(), SwappingController.swap);

/**
 * @openapi
 * /swap-history/{poolAddress}:
 *   get:
 *     summary: Retrieve swap history for a pool
 *     tags: [Swap]
 *     parameters:
 *       - name: poolAddress
 *         in: path
 *         required: true
 *         description: Pool contract address
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         description: Page number (defaults to 1)
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Page size (defaults to 10)
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated swap history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 totalCount:
 *                   type: integer
 */
router.get("/swap-history/:poolAddress", authHandler.authorizeRequest(true), SwappingController.getSwapHistory);

/**
 * @openapi
 * /swap-pools/set-rates:
 *   post:
 *     summary: Update pool fee rates (admin)
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - swapFeeRate
 *               - lpSharePercent
 *             properties:
 *               poolAddress:
 *                 type: string
 *               swapFeeRate:
 *                 type: number
 *                 description: Swap fee in basis points (0-10000)
 *               lpSharePercent:
 *                 type: number
 *                 description: LP share percentage in basis points (0-10000)
 *     responses:
 *       200:
 *         description: Rate update transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/set-rates", authHandler.authorizeRequest(), SwappingController.setPoolRates);

export default router;
