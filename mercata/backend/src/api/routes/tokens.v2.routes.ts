import { Router } from "express";
import authHandler from "../middleware/authHandler";
import TokensV2Controller from "../controllers/tokens.v2.controller";

const router = Router();

/**
 * @openapi
 * /tokens/v2:
 *   get:
 *     summary: Get user tokens (v2)
 *     tags: [Tokens]
 *     parameters:
 *       - name: select
 *         in: query
 *         required: false
 *         description: Optional field selection forwarded to Cirrus
 *         schema:
 *           type: string
 *       - name: status
 *         in: query
 *         required: false
 *         description: Optional status filter
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User tokens list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/", authHandler.authorizeRequest(), TokensV2Controller.getUserTokens);

/**
 * @openapi
 * /tokens/v2/earning-assets:
 *   get:
 *     summary: Get earning assets for the signed-in user (v2)
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Earning assets list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/earning-assets", authHandler.authorizeRequest(), TokensV2Controller.getEarningAssets);

/**
 * @openapi
 * /tokens/v2/balance-history:
 *   get:
 *     summary: Get token balance history for the signed-in user (v2)
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Net balance history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/balance-history/:tokenAddress", authHandler.authorizeRequest(), TokensV2Controller.getBalanceHistory);

/**
 * @openapi
 * /tokens/v2/net-balance-history:
 *   get:
 *     summary: Get net balance history for the signed-in user (v2)
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Net balance history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/net-balance-history", authHandler.authorizeRequest(), TokensV2Controller.getNetBalanceHistory);

/**
 * @openapi
 * /tokens/v2/borrowing-history:
 *   get:
 *     summary: Get borrowing history for the signed-in user (v2)
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Borrowing history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/borrowing-history", authHandler.authorizeRequest(), TokensV2Controller.getBorrowingHistory);

export default router;

