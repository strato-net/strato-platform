import { Router } from "express";
import authHandler from "../middleware/authHandler";
import OracleController from "../controllers/oracle.controller";

const router = Router();

/**
 * @openapi
 * /oracle/price:
 *   get:
 *     summary: Get current price
 *     tags: [Oracle]
 *     parameters:
 *       - name: asset
 *         in: query
 *         required: true
 *         schema: { type: string }
 *         description: Asset address
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
router.get("/price", authHandler.authorizeRequest(true), OracleController.getPrice);

/**
 * @openapi
 * /oracle/price:
 *   post:
 *     summary: Set price
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
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.post("/price", authHandler.authorizeRequest(), OracleController.setPrice);

/**
 * @openapi
 * /oracle/price-history/{assetAddress}:
 *   get:
 *     summary: Get price history
 *     tags: [Oracle]
 *     parameters:
 *       - name: assetAddress
 *         in: path
 *         required: true
 *         schema: { type: string }
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
router.get("/price-history/:assetAddress", authHandler.authorizeRequest(true), OracleController.getPriceHistory);

export default router;
