import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EventsController from "../controllers/events.controller";

const router = Router();

/**
 * @openapi
 * /events:
 *   get:
 *     summary: Get blockchain events
 *     tags: [Events]
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
router.get("/", authHandler.authorizeRequest(), EventsController.getEvents);

/**
 * @openapi
 * /events/contracts:
 *   get:
 *     summary: Get contract information
 *     tags: [Events]
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
router.get("/contracts", authHandler.authorizeRequest(), EventsController.getContractInfo);

export default router;
