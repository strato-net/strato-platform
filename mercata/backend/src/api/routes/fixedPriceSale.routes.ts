import { Router } from "express";
import authHandler from "../middleware/authHandler";
import FixedPriceSaleController from "../controllers/fixedPriceSale.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

// ═══════════════════════════════════════════════════════════════════════════════
// USER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /fixed-price-sale/info:
 *   get:
 *     summary: Get sale global state
 *     tags: [Fixed Price Sale]
 *     responses:
 *       200:
 *         description: Sale info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address: { type: string }
 *                 saleToken:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     address: { type: string }
 *                     symbol: { type: string }
 *                     name: { type: string }
 *                     decimals: { type: integer }
 *                 pricePerTokenUSD: { type: string, description: "USD per sale token, 1e18 = $1" }
 *                 hardCap: { type: string }
 *                 totalSold: { type: string }
 *                 remainingForSale: { type: string }
 *                 perWalletCap: { type: string, description: "0 disables per-wallet cap" }
 *                 inventory: { type: string }
 *                 startTime: { type: string, description: "UNIX seconds" }
 *                 endTime: { type: string, description: "UNIX seconds" }
 *                 paused: { type: boolean }
 *                 active: { type: boolean }
 *                 priceOracle: { type: string }
 *                 paymentTokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address: { type: string }
 *                       symbol: { type: string }
 *                       name: { type: string }
 *                       decimals: { type: integer }
 *                       priceUsd: { type: string }
 */
router.get("/info", authHandler.authorizeRequest(true), FixedPriceSaleController.getInfo);

/**
 * @openapi
 * /fixed-price-sale/user:
 *   get:
 *     summary: Get authenticated user's sale position
 *     tags: [Fixed Price Sale]
 *     responses:
 *       200:
 *         description: User position
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 purchased: { type: string }
 *                 remainingForWallet: { type: string }
 */
router.get("/user", authHandler.authorizeRequest(), FixedPriceSaleController.getUserPosition);

/**
 * @openapi
 * /fixed-price-sale/quote:
 *   get:
 *     summary: Quote payment amount for a desired sale-token purchase
 *     tags: [Fixed Price Sale]
 *     parameters:
 *       - in: query
 *         name: paymentToken
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: saleAmount
 *         required: true
 *         schema: { type: string }
 *         description: Sale tokens desired (18 decimals)
 *     responses:
 *       200:
 *         description: Quote result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paymentAmount: { type: string }
 *                 usdValue: { type: string }
 *                 paymentPrice: { type: string }
 */
router.get("/quote", authHandler.authorizeRequest(true), FixedPriceSaleController.quote);

/**
 * @openapi
 * /fixed-price-sale/purchases:
 *   get:
 *     summary: Get recent Purchased events
 *     tags: [Fixed Price Sale]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Recent purchases
 */
router.get("/purchases", authHandler.authorizeRequest(true), FixedPriceSaleController.recentPurchases);

/**
 * @openapi
 * /fixed-price-sale/buy:
 *   post:
 *     summary: Buy sale tokens
 *     tags: [Fixed Price Sale]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentToken, saleAmount, paymentAmount]
 *             properties:
 *               paymentToken: { type: string }
 *               saleAmount: { type: string, description: "Sale tokens to buy (18 decimals)" }
 *               paymentAmount: { type: string, description: "Payment tokens to approve (18 decimals)" }
 *     responses:
 *       200:
 *         description: Buy transaction result
 */
router.post("/buy", walletAuth, FixedPriceSaleController.buy);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/admin/pause", walletAuth, FixedPriceSaleController.pause);
router.post("/admin/unpause", walletAuth, FixedPriceSaleController.unpause);
router.post("/admin/payment-tokens", walletAuth, FixedPriceSaleController.addPaymentToken);
router.delete("/admin/payment-tokens", walletAuth, FixedPriceSaleController.removePaymentToken);
router.post("/admin/price", walletAuth, FixedPriceSaleController.setPrice);
router.post("/admin/hard-cap", walletAuth, FixedPriceSaleController.setHardCap);
router.post("/admin/per-wallet-cap", walletAuth, FixedPriceSaleController.setPerWalletCap);
router.post("/admin/schedule", walletAuth, FixedPriceSaleController.setSchedule);
router.post("/admin/sweep-proceeds", walletAuth, FixedPriceSaleController.sweepProceeds);
router.post("/admin/sweep-unsold", walletAuth, FixedPriceSaleController.sweepUnsold);

export default router;
