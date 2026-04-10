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
 * /swap-pools/{poolAddress}/liquidity/multi-token:
 *   post:
 *     summary: Add liquidity to a multi-token stable pool
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
 *               - amounts
 *               - minMintAmount
 *             properties:
 *               amounts:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Token amounts indexed by coin position (decimal strings)
 *               minMintAmount:
 *                 type: string
 *                 description: Minimum LP tokens to mint (decimal string)
 *               stakeLPToken:
 *                 type: boolean
 *                 description: Whether to stake LP tokens in RewardsChef
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   delete:
 *     summary: Remove liquidity proportionally from a multi-token stable pool
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
 *               - minAmounts
 *             properties:
 *               lpTokenAmount:
 *                 type: string
 *                 description: LP token amount to redeem (decimal string)
 *               minAmounts:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Minimum amounts per coin (decimal strings)
 *               includeStakedLPToken:
 *                 type: boolean
 *                 description: Whether to include staked LP tokens
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/:poolAddress/liquidity/multi-token", authHandler.authorizeRequest(), SwappingController.addLiquidityMultiToken);
router.delete("/swap-pools/:poolAddress/liquidity/multi-token", authHandler.authorizeRequest(), SwappingController.removeLiquidityMultiToken);

/**
 * @openapi
 * /swap-pools/{poolAddress}/liquidity/multi-token/one-coin:
 *   delete:
 *     summary: Remove liquidity as a single coin from a multi-token stable pool
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
 *               - coinIndex
 *               - minReceived
 *             properties:
 *               lpTokenAmount:
 *                 type: string
 *                 description: LP token amount to redeem (decimal string)
 *               coinIndex:
 *                 type: integer
 *                 description: Index of the coin to receive
 *               minReceived:
 *                 type: string
 *                 description: Minimum amount to receive (decimal string)
 *               includeStakedLPToken:
 *                 type: boolean
 *                 description: Whether to include staked LP tokens
 *     responses:
 *       200:
 *         description: Liquidity transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.delete("/swap-pools/:poolAddress/liquidity/multi-token/one-coin", authHandler.authorizeRequest(), SwappingController.removeLiquidityMultiTokenOneCoin);

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
 * /swap/multi-token:
 *   post:
 *     summary: Execute a multi-token stable pool swap
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - tokenIn
 *               - tokenOut
 *               - amountIn
 *               - minAmountOut
 *             properties:
 *               poolAddress:
 *                 type: string
 *               tokenIn:
 *                 type: string
 *                 description: Address of the input token
 *               tokenOut:
 *                 type: string
 *                 description: Address of the output token
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
router.post("/swap/multi-token", authHandler.authorizeRequest(), SwappingController.swapMultiToken);

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
 *       - name: sender
 *         in: query
 *         required: false
 *         description: Filter by sender address (user who performed the swap)
 *         schema:
 *           type: string
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

/**
 * @openapi
 * /swap-pools/toggle-pause:
 *   post:
 *     summary: Toggle pause state of a swap pool (admin)
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - isPaused
 *             properties:
 *               poolAddress:
 *                 type: string
 *               isPaused:
 *                 type: boolean
 *                 description: true to pause, false to unpause
 *     responses:
 *       200:
 *         description: Transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/toggle-pause", authHandler.authorizeRequest(), SwappingController.togglePause);

/**
 * @openapi
 * /swap-pools/toggle-disable:
 *   post:
 *     summary: Toggle disabled state of a swap pool (admin)
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - poolAddress
 *               - isDisabled
 *             properties:
 *               poolAddress:
 *                 type: string
 *               isDisabled:
 *                 type: boolean
 *                 description: true to disable, false to enable
 *     responses:
 *       200:
 *         description: Transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/swap-pools/toggle-disable", authHandler.authorizeRequest(), SwappingController.toggleDisable);

export default router;
