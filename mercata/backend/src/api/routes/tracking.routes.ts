import { Router } from "express";
import authHandler from "../middleware/authHandler";
import TrackingController from "../controllers/tracking.controller";

const router = Router();

/**
 * @openapi
 * /tracking/activity:
 *   post:
 *     summary: Categorized on-chain activity for a set of wallet addresses
 *     description: >
 *       Used by the tracking-links dashboard. The tracking service holds only
 *       offchain data; the UI passes the connected wallet addresses here to
 *       fetch bridge-ins and categorized Cirrus events, then joins the two
 *       datasets client-side. All data returned is public chain state.
 *     tags: [Tracking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bridge-ins and categorized events for the addresses
 */
router.post("/activity", authHandler.authorizeRequest(), TrackingController.getActivity);

export default router;
