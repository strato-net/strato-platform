import { Router } from "express";
import authHandler from "../middleware/authHandler";
import OracleController from "../controllers/oracle.controller";

const router = Router();

/**
 * @openapi
 * /oracle/price:
 *   get:
 *     summary: Fetch oracle price data
 *     tags: [Oracle]
 *     parameters:
 *       - name: asset
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional asset address to filter for a single price
 *     responses:
 *       200:
 *         description: Oracle price information
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 - type: object
 *                   additionalProperties: true
 */
router.get("/price", authHandler.authorizeRequest(true), OracleController.getPrice);

/**
 * @openapi
 * /oracle/price:
 *   post:
 *     summary: Set an oracle price (admin)
 *     tags: [Oracle]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, price]
 *             properties:
 *               token: { type: string, description: "Token address" }
 *               price: { type: string, description: "Price value" }
 *     responses:
 *       200:
 *         description: Price update transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/price", authHandler.authorizeRequest(), OracleController.setPrice);

/**
 * @openapi
 * /oracle/price-history/{assetAddress}:
 *   get:
 *     summary: Retrieve historical oracle prices
 *     tags: [Oracle]
 *     parameters:
 *       - name: assetAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: duration
 *         in: query
 *         required: false
 *         description: Time duration (1d, 7d, 1m, 3m, 6m, 1y, all). Defaults to 1m.
 *         schema:
 *           type: string
 *       - name: end
 *         in: query
 *         required: false
 *         description: End timestamp (ISO string). Defaults to now.
 *         schema:
 *           type: string
 *       - name: order
 *         in: query
 *         required: false
 *         description: Optional order clause (defaults to block_timestamp.asc)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Historical price data
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
router.get("/price-history/:assetAddress", authHandler.authorizeRequest(true), OracleController.getPriceHistory);

export default router;
