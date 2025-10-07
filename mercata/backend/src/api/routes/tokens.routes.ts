import { Router } from "express";
import authHandler from "../middleware/authHandler";
import TokensController from "../controllers/tokens.controller";

const router = Router();

/**
 * @openapi
 * /tokens/balance:
 *   get:
 *     summary: Get token balance
 *     tags: [Tokens]
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
router.get("/balance", authHandler.authorizeRequest(), TokensController.getBalance);

/**
 * @openapi
 * /tokens/{address}:
 *   get:
 *     summary: Get token by address
 *     tags: [Tokens]
 *     parameters:
 *       - name: address
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
 *                 data: { type: object }
 */
router.get("/:address", authHandler.authorizeRequest(true), TokensController.get);

/**
 * @openapi
 * /tokens:
 *   get:
 *     summary: Get all tokens
 *     tags: [Tokens]
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
 *   post:
 *     summary: Create a new token
 *     tags: [Tokens]
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
router.get("/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/", authHandler.authorizeRequest(), TokensController.create);

/**
 * @openapi
 * /tokens/transfer:
 *   post:
 *     summary: Transfer tokens
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, to, value]
 *             properties:
 *               address: { type: string, description: "Token contract address" }
 *               to: { type: string, description: "Recipient address" }
 *               value: { type: string, description: "Amount to transfer" }
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
router.post("/transfer", authHandler.authorizeRequest(), TokensController.transfer);

/**
 * @openapi
 * /tokens/approve:
 *   post:
 *     summary: Approve token spending
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, spender, value]
 *             properties:
 *               address: { type: string, description: "Token contract address" }
 *               spender: { type: string, description: "Spender address" }
 *               value: { type: string, description: "Amount to approve" }
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
router.post("/approve", authHandler.authorizeRequest(), TokensController.approve);

/**
 * @openapi
 * /tokens/transferFrom:
 *   post:
 *     summary: Transfer tokens from another address
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, from, to, value]
 *             properties:
 *               address: { type: string, description: "Token contract address" }
 *               from: { type: string, description: "Source address" }
 *               to: { type: string, description: "Recipient address" }
 *               value: { type: string, description: "Amount to transfer" }
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
router.post("/transferFrom", authHandler.authorizeRequest(), TokensController.transferFrom);

/**
 * @openapi
 * /tokens/setStatus:
 *   post:
 *     summary: Set token status
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, status]
 *             properties:
 *               address: { type: string, description: "Token contract address" }
 *               status: { type: integer, enum: [1, 2, 3], description: "Status: 1=PENDING, 2=ACTIVE, 3=LEGACY" }
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
router.post("/setStatus", authHandler.authorizeRequest(), TokensController.setStatus);

export default router;
