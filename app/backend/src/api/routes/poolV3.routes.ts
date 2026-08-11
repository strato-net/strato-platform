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
 *     description: >-
 *       Supply the initial price as EITHER `price` (human-readable) OR `initialSqrtPriceX96`
 *       (raw Q64.96) — exactly one is required. `tokenA` becomes token0 and `tokenB` token1,
 *       so the price is token1-per-token0 (tokenB per tokenA). `price` is converted to Q64.96
 *       server-side using each token's decimals.
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokenA, tokenB, fee]
 *             oneOf:
 *               - { required: [price] }
 *               - { required: [initialSqrtPriceX96] }
 *             properties:
 *               tokenA: { type: string, description: "becomes token0" }
 *               tokenB: { type: string, description: "becomes token1" }
 *               fee: { type: integer, description: "fee tier in pips; must be enabled (default 500/3000/10000)" }
 *               price: { type: string, description: "human-readable initial price, tokenB per tokenA (e.g. \"2000\", \"1793.25\"); converted to Q64.96 using token decimals. Provide this OR initialSqrtPriceX96" }
 *               initialSqrtPriceX96: { type: string, description: "raw Q64.96 sqrt price, decimal string. Provide this OR price" }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.get("/pools", authHandler.authorizeRequest(true), PoolV3Controller.getAll);
router.post("/pools", walletAuth, PoolV3Controller.create);

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
 * /poolv3/pools/{poolAddress}/liquidity:
 *   get:
 *     summary: Liquidity distribution across the price axis (depth-chart data)
 *     tags: [PoolV3]
 *     parameters:
 *       - { name: poolAddress, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Active liquidity per initialized-tick interval, plus current tick/spacing
 */
router.get("/pools/:poolAddress/liquidity", authHandler.authorizeRequest(true), PoolV3Controller.liquidity);

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
 *     summary: Mint a liquidity position NFT (PositionManagerV3)
 *     description: >-
 *       New positions are always minted through PositionManagerV3 and represented as
 *       ERC-721 tokens. The manager computes liquidity from the desired amounts at the
 *       current price and pulls exactly the pool-computed deposit from the caller.
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [poolAddress, tickLower, tickUpper, amount0Desired, amount1Desired]
 *             properties:
 *               poolAddress: { type: string }
 *               tickLower: { type: integer }
 *               tickUpper: { type: integer }
 *               amount0Desired: { type: string, description: "maximum token0 to deposit" }
 *               amount1Desired: { type: string, description: "maximum token1 to deposit" }
 *               amount0Min: { type: string, description: "minimum token0 that must be deposited (slippage check), default 0" }
 *               amount1Min: { type: string, description: "minimum token1 that must be deposited (slippage check), default 0" }
 *     responses:
 *       200:
 *         description: Transaction result
 *   delete:
 *     summary: Remove liquidity from a position (optionally collecting owed tokens)
 *     description: >-
 *       Address the position by `tokenId` (position NFTs) OR by poolAddress + ticks
 *       (legacy positions held directly on the pool) — exactly one addressing mode.
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [liquidity]
 *             properties:
 *               tokenId: { type: string, description: "position NFT id (NFT path)" }
 *               poolAddress: { type: string, description: "legacy path" }
 *               tickLower: { type: integer, description: "legacy path" }
 *               tickUpper: { type: integer, description: "legacy path" }
 *               liquidity: { type: string }
 *               amount0Min: { type: string, description: "slippage check (NFT path), default 0" }
 *               amount1Min: { type: string, description: "slippage check (NFT path), default 0" }
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
 * /poolv3/positions/increase:
 *   post:
 *     summary: Add liquidity to an existing position NFT (same range)
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tokenId, amount0Desired, amount1Desired]
 *             properties:
 *               tokenId: { type: string }
 *               amount0Desired: { type: string }
 *               amount1Desired: { type: string }
 *               amount0Min: { type: string, description: "slippage check, default 0" }
 *               amount1Min: { type: string, description: "slippage check, default 0" }
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.post("/positions/increase", walletAuth, PoolV3Controller.increase);

/**
 * @openapi
 * /poolv3/positions/collect:
 *   post:
 *     summary: Collect owed tokens (burned principal + fees) from a position
 *     description: >-
 *       Same dual addressing as DELETE /positions — `tokenId` for position NFTs
 *       (the manager pokes the pool internally), or poolAddress + ticks for legacy
 *       positions (a poke transaction is prepended when the position has liquidity).
 *     tags: [PoolV3]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenId: { type: string, description: "position NFT id (NFT path)" }
 *               poolAddress: { type: string, description: "legacy path" }
 *               tickLower: { type: integer, description: "legacy path" }
 *               tickUpper: { type: integer, description: "legacy path" }
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
