import { Router } from "express";
import authHandler from "../middleware/authHandler";
import FeesController from "../controllers/fees.controller";

const router = Router();

/**
 * @openapi
 * /fees/quote:
 *   get:
 *     summary: What one contract call costs the signed-in user right now
 *     description: The fee router's per-call charge (STRATO, or USDST before the STRATO-gas router), its price version and validity, the user's whole vouchers (each covers one call) and their balance of the fee currency.
 *     tags: [Fees]
 *     responses:
 *       200:
 *         description: Fee quote
 */
router.get("/quote", authHandler.authorizeRequest(), FeesController.getQuote);

export default router;
