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

export default router;
