import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LoopController from "../controllers/loop.controller";

const router = Router();

/**
 * @openapi
 * /loop/bootstrap:
 *   get:
 *     summary: Get all data needed for frontend local loop quote calculations
 *     tags: [Loop]
 *     security: []
 *     responses:
 *       200:
 *         description: Bootstrap payload with lending and CDP route data
 */
router.get("/bootstrap", authHandler.authorizeRequest(true), LoopController.bootstrap);

/**
 * @openapi
 * /loop/execute:
 *   post:
 *     summary: Execute a looping strategy (sync blocking)
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
 *               - loops
 *             properties:
 *               routeType:
 *                 type: string
 *                 enum: [lending_loop, cdp_loop]
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *               loops:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               minHealthFactor:
 *                 type: number
 *               clientQuoteHash:
 *                 type: string
 *               dryRun:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Execution result with per-step statuses and tx hashes
 */
router.post("/execute", authHandler.authorizeRequest(), LoopController.execute);

/**
 * @openapi
 * /loop/position:
 *   get:
 *     summary: Get user current looped position across lending and CDP
 *     tags: [Loop]
 *     responses:
 *       200:
 *         description: Current positions with collateral, debt, leverage, health factor, estimated carry
 */
router.get("/position", authHandler.authorizeRequest(), LoopController.position);

/**
 * @openapi
 * /loop/unwind:
 *   post:
 *     summary: Unwind (reduce/close) a looped position
 *     tags: [Loop]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - routeType
 *               - asset
 *               - steps
 *             properties:
 *               routeType:
 *                 type: string
 *                 enum: [lending_loop, cdp_loop]
 *               asset:
 *                 type: string
 *               steps:
 *                 oneOf:
 *                   - type: integer
 *                     minimum: 1
 *                     maximum: 5
 *                   - type: string
 *                     enum: [all]
 *               minHealthFactor:
 *                 type: number
 *     responses:
 *       200:
 *         description: Unwind result with per-step statuses, tx hashes, and terminal state
 */
router.post("/unwind", authHandler.authorizeRequest(), LoopController.unwind);

/**
 * @openapi
 * /loop/history:
 *   get:
 *     summary: Get user loop execution history
 *     tags: [Loop]
 *     responses:
 *       200:
 *         description: List of past loop executions
 */
router.get("/history", authHandler.authorizeRequest(), LoopController.history);

export default router;
