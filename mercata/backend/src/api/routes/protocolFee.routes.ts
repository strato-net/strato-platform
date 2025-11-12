/**
 * Protocol Fee Routes
 */

import { Router } from "express";
import authHandler from "../middleware/authHandler";
import ProtocolFeeController from "../controllers/protocolFee.controller";

const router = Router();

/**
 * @openapi
 * /protocol-fees/revenue:
 *   get:
 *     summary: Get aggregated protocol revenue across all protocols
 *     tags: [Protocol Fees]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Aggregated protocol revenue data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalRevenue:
 *                   type: string
 *                   description: Total aggregated revenue across all protocols
 *                 byProtocol:
 *                   type: object
 *                   properties:
 *                     cdp:
 *                       $ref: '#/components/schemas/ProtocolRevenue'
 *                     lending:
 *                       $ref: '#/components/schemas/ProtocolRevenue'
 *                     swap:
 *                       $ref: '#/components/schemas/ProtocolRevenue'
 *                 aggregated:
 *                   $ref: '#/components/schemas/RevenueByPeriod'
 */
router.get("/revenue", authHandler.authorizeRequest(true), ProtocolFeeController.getAggregatedRevenue);

/**
 * @openapi
 * /protocol-fees/revenue/{protocol}:
 *   get:
 *     summary: Get protocol revenue for a specific protocol
 *     tags: [Protocol Fees]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: protocol
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [cdp, lending, swap]
 *         description: Protocol to get revenue for
 *       - name: period
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, ytd, allTime]
 *         description: Optional time period filter
 *     responses:
 *       200:
 *         description: Protocol revenue data
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ProtocolRevenue'
 *                 - $ref: '#/components/schemas/RevenuePeriod'
 *       400:
 *         description: Invalid protocol or period parameter
 */
router.get("/revenue/:protocol", authHandler.authorizeRequest(true), ProtocolFeeController.getProtocolRevenue);

/**
 * @openapi
 * /protocol-fees/revenue/period/{period}:
 *   get:
 *     summary: Get protocol revenue by period (aggregated or specific protocol)
 *     tags: [Protocol Fees]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: period
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, ytd, allTime]
 *         description: Time period to get revenue for
 *       - name: protocol
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [cdp, lending, swap]
 *         description: Optional protocol filter
 *     responses:
 *       200:
 *         description: Revenue data for the specified period
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RevenuePeriod'
 *       400:
 *         description: Invalid period or protocol parameter
 */
router.get("/revenue/period/:period", authHandler.authorizeRequest(true), ProtocolFeeController.getRevenueByPeriod);

export default router;
