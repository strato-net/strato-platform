import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LoopController from "../controllers/loop.controller";

const router = Router();

/**
 * @openapi
 * /loop/bootstrap:
 *   get:
 *     summary: Get CDP loop bootstrap data for frontend quote calculations
 *     tags: [Loop]
 *     security: []
 *     responses:
 *       200:
 *         description: Bootstrap payload with CDP route data and loop opportunities
 */
router.get("/bootstrap", authHandler.authorizeRequest(true), LoopController.bootstrap);

/**
 * @openapi
 * /loop/execute:
 *   post:
 *     summary: Execute a CDP leverage loop via LoopRouter (atomic)
 *     tags: [Loop]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optional key to prevent duplicate execution
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - routeType
 *               - asset
 *               - amount
 *             properties:
 *               routeType:
 *                 type: string
 *                 enum: [cdp_loop]
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *               targetLeverage:
 *                 type: number
 *               maxSlippageBps:
 *                 type: integer
 *               minHealthFactor:
 *                 type: number
 *               clientQuoteHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Execution result with step status and tx hash
 */
router.post("/execute", authHandler.authorizeRequest(), LoopController.execute);

/**
 * @openapi
 * /loop/position:
 *   get:
 *     summary: Get user current CDP positions
 *     tags: [Loop]
 *     responses:
 *       200:
 *         description: Current positions with collateral, debt, leverage, health factor, estimated carry
 */
router.get("/position", authHandler.authorizeRequest(), LoopController.position);

export default router;
