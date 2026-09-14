import { Router } from "express";
import authHandler from "../middleware/authHandler";
import MetricsController from "../controllers/metrics.controller";

const router = Router();

/**
 * @openapi
 * /v1/metrics/tvl:
 *   get:
 *     summary: Get protocol TVL metrics
 *     description: Retrieve the canonical STRATO TVL snapshot across DeFi-locked protocol balances
 *     tags: [Metrics]
 *     responses:
 *       200:
 *         description: TVL metrics payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/tvl", authHandler.authorizeRequest(true), MetricsController.getTvl);

/**
 * @openapi
 * /v1/metrics/stablecoins:
 *   get:
 *     summary: Get stablecoin supply metrics
 *     description: Retrieve circulating stablecoin metrics for STRATO-recognized stable assets
 *     tags: [Metrics]
 *     responses:
 *       200:
 *         description: Stablecoin metrics payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/stablecoins", authHandler.authorizeRequest(true), MetricsController.getStablecoins);

/**
 * @openapi
 * /v1/metrics/supply:
 *   get:
 *     summary: Get token supply metrics
 *     description: Total and circulating supply for STRATO, USDST, GOLDST and SILVST, with the non-circulating wallets and bridge custody balances behind each figure
 *     tags: [Metrics]
 *     responses:
 *       200:
 *         description: Supply metrics payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/supply", authHandler.authorizeRequest(true), MetricsController.getSupply);

/**
 * @openapi
 * /v1/metrics/supply/{token}/total:
 *   get:
 *     summary: Get a token's total supply as a plain number
 *     description: Total supply with decimals applied, in the bare-number format CoinGecko and CoinMarketCap poll
 *     tags: [Metrics]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token symbol (case-insensitive) or address
 *     responses:
 *       200:
 *         description: Total supply
 *         content:
 *           application/json:
 *             schema:
 *               type: number
 *       404:
 *         description: The token is not a reported token
 */
router.get("/supply/:token/total", authHandler.authorizeRequest(true), MetricsController.getTotalSupply);

/**
 * @openapi
 * /v1/metrics/supply/{token}/circulating:
 *   get:
 *     summary: Get a token's circulating supply as a plain number
 *     description: Circulating supply with decimals applied, in the bare-number format CoinGecko and CoinMarketCap poll
 *     tags: [Metrics]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token symbol (case-insensitive) or address
 *     responses:
 *       200:
 *         description: Circulating supply
 *         content:
 *           application/json:
 *             schema:
 *               type: number
 *       404:
 *         description: The token is not a reported token
 */
router.get("/supply/:token/circulating", authHandler.authorizeRequest(true), MetricsController.getCirculatingSupply);

export default router;
