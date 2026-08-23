import { Router } from "express";
import authHandler from "../middleware/authHandler";
import TradeController from "../controllers/trade.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

/**
 * @openapi
 * /trade/tokens:
 *   get:
 *     summary: List all tokens tradable on any pool (V2, stable, or V3)
 *     tags: [Trade]
 *     responses:
 *       200:
 *         description: Tradable tokens with user balances and pool balances
 */
router.get("/tokens", authHandler.authorizeRequest(), TradeController.tokens);

/**
 * @openapi
 * /trade/tokens/{tokenAddress}/pairs:
 *   get:
 *     summary: List tokens tradable against the given token
 *     tags: [Trade]
 *     parameters:
 *       - name: tokenAddress
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pairable tokens with user balances and pool balances
 */
router.get("/tokens/:tokenAddress/pairs", authHandler.authorizeRequest(), TradeController.pairableTokens);

/**
 * @openapi
 * /trade/pools/{tokenAddress1}/{tokenAddress2}:
 *   get:
 *     summary: All pools that can trade the pair, normalized across pool types (V2, stable, V3 fee tiers)
 *     tags: [Trade]
 *     parameters:
 *       - name: tokenAddress1
 *         in: path
 *         required: true
 *         description: The input-side token; pool sides are oriented to it
 *         schema:
 *           type: string
 *       - name: tokenAddress2
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Normalized TradePool list (label, fee, oriented balances, spot and oracle rates, TVL)
 */
router.get("/pools/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), TradeController.pools);

/**
 * @openapi
 * /trade/quote:
 *   get:
 *     summary: Exact quotes for a pair across every candidate pool, computed with each contract's own math
 *     tags: [Trade]
 *     parameters:
 *       - name: tokenIn
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: tokenOut
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: amount
 *         in: query
 *         required: true
 *         description: Positive wei amount of the independent side
 *         schema:
 *           type: string
 *       - name: type
 *         in: query
 *         required: true
 *         description: EXACT_INPUT quotes output for a given input; EXACT_OUTPUT quotes required input
 *         schema:
 *           type: string
 *           enum: [EXACT_INPUT, EXACT_OUTPUT]
 *     responses:
 *       200:
 *         description: Per-pool quotes plus the best executable pool address
 */
router.get("/quote", authHandler.authorizeRequest(true), TradeController.quote);

/**
 * @openapi
 * /trade/swap:
 *   post:
 *     summary: Execute a swap on any pool type; the pool address determines the contract call
 *     tags: [Trade]
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
 *               tokenOut:
 *                 type: string
 *               amountIn:
 *                 type: string
 *                 description: Input amount in wei (executed as exact input on all pool types)
 *               minAmountOut:
 *                 type: string
 *                 description: Slippage floor in wei
 *     responses:
 *       200:
 *         description: Swap transaction payload
 */
router.post("/swap", walletAuth, TradeController.swap);

/**
 *
 * /trade/token-history/{tokenAddress}:
 *   get:
 *     summary: Recent swaps involving a single token across all pool types
 *     tags: [Trade]
 *     parameters:
 *       - name: tokenAddress
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated merged history; entries carry poolName ("V2" / "Stable" / "V3 0.3%")
 */
router.get("/token-history/:tokenAddress", authHandler.authorizeRequest(true), TradeController.tokenHistory);

/**
 * @openapi
 * /trade/history/{tokenAddress1}/{tokenAddress2}:
 *   get:
 *     summary: Unified swap history for a pair across all pool types
 *     tags: [Trade]
 *     parameters:
 *       - name: tokenAddress1
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: tokenAddress2
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: page
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *       - name: sender
 *         in: query
 *         required: false
 *         description: Filter to the user's trades
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated merged history; entries carry poolName ("V2" / "Stable" / "V3 0.3%")
 */
router.get("/history/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), TradeController.history);

export default router;
