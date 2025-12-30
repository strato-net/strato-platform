import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EventsController from "../controllers/events.controller";

const router = Router();

/**
 * @openapi
 * /events:
 *   get:
 *     summary: Query Mercata blockchain events
 *     tags: [Events]
 *     parameters:
 *       - name: order
 *         in: query
 *         required: false
 *         description: Order clause, e.g. block_timestamp.desc
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Maximum number of events to return
 *         schema:
 *           type: string
 *       - name: offset
 *         in: query
 *         required: false
 *         description: Number of events to skip for pagination
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Event list with total count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 total:
 *                   type: integer
 */
router.get("/", authHandler.authorizeRequest(), EventsController.getEvents);

/**
 * @openapi
 * /events/contracts:
 *   get:
 *     summary: List contracts with emitted events
 *     tags: [Events]
 *     responses:
 *       200:
 *         description: Contract catalog grouped by name
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contracts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       events:
 *                         type: array
 *                         items:
 *                           type: string
 */
router.get("/contracts", authHandler.authorizeRequest(), EventsController.getContractInfo);

/**
 * @openapi
 * /events/activities:
 *   get:
 *     summary: Get user-friendly activity feed
 *     tags: [Events]
 *     parameters:
 *       - name: user
 *         in: query
 *         description: Filter by user address (for My Activity)
 *         schema:
 *           type: string
 *       - name: type
 *         in: query
 *         description: Filter by activity type (deposit, withdraw, borrow, swap, bridge, cdp)
 *         schema:
 *           type: string
 *       - name: period
 *         in: query
 *         description: Filter by time period (today, week, month, all)
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 20
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Activity list with total count
 */
router.get("/activities", authHandler.authorizeRequest(), EventsController.getActivities);

export default router;
