import { Router } from "express";
import authHandler from "../middleware/authHandler";
import PoolV3Controller from "../controllers/poolV3.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

/**
 * @openapi
 * /poolv3/pools:
 *   get:
 *     summary: List concentrated liquidity (V3) pools
 *     tags: [PoolV3]
 *     responses:
 *       200:
 *         description: V3 pool list (deepest liquidity first)
 *   post:
 *     summary: Create a V3 pool (admin; owner is AdminRegistry, may raise a governance vote)
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokenA, tokenB, fee, initialSqrtPriceX96]
 *             properties:
 *               tokenA: { type: string }
 *               tokenB: { type: string }
 *               fee: { type: integer, description: "fee tier in pips (500/3000/10000)" }
 *               initialSqrtPriceX96: { type: string, description: "Q64.96 sqrt price, decimal string" }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.get("/pools", authHandler.authorizeRequest(true), PoolV3Controller.getAll);
router.post("/pools", walletAuth, PoolV3Controller.create);

/**
 * @openapi
 * /poolv3/pools/pair/{tokenAddress1}/{tokenAddress2}:
 *   get:
 *     summary: V3 pools for a token pair (all fee tiers, either token order)
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: tokenAddress1, in: path, required: true, schema: { type: string } }
 *       - { name: tokenAddress2, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Matching V3 pools, deepest liquidity first
 */
router.get("/pools/pair/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), PoolV3Controller.getByPair);

/**
 * @openapi
 * /poolv3/pools/{poolAddress}:
 *   get:
 *     summary: Fetch a V3 pool by address
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: poolAddress, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Pool detail
 */
router.get("/pools/:poolAddress", authHandler.authorizeRequest(true), PoolV3Controller.get);

/**
 * @openapi
 * /poolv3/quote:
 *   get:
 *     summary: Quote a V3 swap by simulating the tick-walking swap loop over indexed state
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: poolAddress, in: query, required: true, schema: { type: string } }
 *       - { name: zeroForOne, in: query, required: true, schema: { type: string, enum: ["true", "false"] } }
 *       - name: amountSpecified
 *         in: query
 *         required: true
 *         description: Positive = exact input, negative = exact output (wei string)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quote with amounts, fee, post-swap price/tick, price impact
 */
router.get("/quote", authHandler.authorizeRequest(true), PoolV3Controller.quote);

/**
 * @openapi
 * /poolv3/swap:
 *   post:
 *     summary: Execute a V3 swap (exact input or exact output) via the caller's wallet
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [poolAddress, zeroForOne, amountSpecified, amountLimit]
 *             properties:
 *               poolAddress: { type: string }
 *               zeroForOne: { type: boolean, description: "true = token0 in / token1 out" }
 *               amountSpecified: { type: string, description: "signed: >0 exact input, <0 exact output" }
 *               amountLimit: { type: string, description: "exact-in: min output; exact-out: max input" }
 *               sqrtPriceLimitX96: { type: string, description: "optional price limit (0 = tick-domain edge)" }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.post("/swap", walletAuth, PoolV3Controller.swap);

/**
 * @openapi
 * /poolv3/positions:
 *   get:
 *     summary: List the caller's V3 positions (optionally filtered by pool)
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: poolAddress, in: query, required: false, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Positions with computed amounts and range status
 *   post:
 *     summary: Mint liquidity into a tick range
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [poolAddress, tickLower, tickUpper, liquidity, amount0Max, amount1Max]
 *             properties:
 *               poolAddress: { type: string }
 *               tickLower: { type: integer }
 *               tickUpper: { type: integer }
 *               liquidity: { type: string }
 *               amount0Max: { type: string, description: "slippage cap on token0 deposit" }
 *               amount1Max: { type: string, description: "slippage cap on token1 deposit" }
 *     responses:
 *       200:
 *         description: Transaction result
 *   delete:
 *     summary: Burn liquidity from a position (optionally collecting owed tokens)
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [poolAddress, tickLower, tickUpper, liquidity]
 *             properties:
 *               poolAddress: { type: string }
 *               tickLower: { type: integer }
 *               tickUpper: { type: integer }
 *               liquidity: { type: string }
 *               collect: { type: boolean, description: "also collect all owed tokens" }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.get("/positions", authHandler.authorizeRequest(), PoolV3Controller.positions);
router.post("/positions", walletAuth, PoolV3Controller.mint);
router.delete("/positions", walletAuth, PoolV3Controller.burn);

/**
 * @openapi
 * /poolv3/positions/collect:
 *   post:
 *     summary: Collect owed tokens (burned principal + fees) from a position
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [poolAddress, tickLower, tickUpper]
 *             properties:
 *               poolAddress: { type: string }
 *               tickLower: { type: integer }
 *               tickUpper: { type: integer }
 *               amount0Requested: { type: string }
 *               amount1Requested: { type: string }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.post("/positions/collect", walletAuth, PoolV3Controller.collect);

/**
 * @openapi
 * /poolv3/amounts-for-liquidity:
 *   get:
 *     summary: Preview token amounts for a liquidity value (or liquidity for desired amounts)
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: poolAddress, in: query, required: true, schema: { type: string } }
 *       - { name: tickLower, in: query, required: true, schema: { type: integer } }
 *       - { name: tickUpper, in: query, required: true, schema: { type: integer } }
 *       - { name: liquidity, in: query, required: false, schema: { type: string } }
 *       - { name: amount0Desired, in: query, required: false, schema: { type: string } }
 *       - { name: amount1Desired, in: query, required: false, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Amount preview
 */
router.get("/amounts-for-liquidity", authHandler.authorizeRequest(true), PoolV3Controller.amountsForLiquidity);

export default router;
