import { Router } from "express";
import authHandler from "../middleware/authHandler";
import TokensController from "../controllers/tokens.controller";

const router = Router();

/**
 * @openapi
 * /tokens/balance:
 *   get:
 *     summary: Retrieve token balances for the signed-in user
 *     tags: [Tokens]
 *     parameters:
 *       - name: select
 *         in: query
 *         required: false
 *         description: Optional field selection forwarded to Cirrus
 *         schema:
 *           type: string
 *       - name: address
 *         in: query
 *         required: false
 *         description: Optional token address filter
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token balance entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/balance", authHandler.authorizeRequest(), TokensController.getBalance);

/**
 * @openapi
 * /tokens/{address}:
 *   get:
 *     summary: Fetch token metadata by address
 *     tags: [Tokens]
 *     parameters:
 *       - name: address
 *         in: path
 *         required: true
 *         description: Token contract address
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/:address", authHandler.authorizeRequest(true), TokensController.get);

/**
 * @openapi
 * /tokens:
 *   get:
 *     summary: List tokens registered on Mercata
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
 *       - name: limit
 *         in: query
 *         required: false
 *         description: "Number of tokens per page (default: 10, max: 100)"
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *       - name: offset
 *         in: query
 *         required: false
 *         description: "Number of tokens to skip (default: 0)"
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Token list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of tokens
 *                     page:
 *                       type: integer
 *                       description: Current page number
 *                     limit:
 *                       type: integer
 *                       description: Number of tokens per page
 *                     totalPages:
 *                       type: integer
 *                       description: Total number of pages
 *                     hasNext:
 *                       type: boolean
 *                       description: Whether there are more pages
 *                     hasPrevious:
 *                       type: boolean
 *                       description: Whether there are previous pages
 *   post:
 *     summary: Create a new token (admin)
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *               - symbol
 *               - initialSupply
 *               - customDecimals
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               symbol:
 *                 type: string
 *               initialSupply:
 *                 type: string
 *                 description: Initial supply expressed as a decimal string
 *               customDecimals:
 *                 type: integer
 *               images:
 *                 type: string
 *                 description: JSON-encoded array of image URIs
 *               files:
 *                 type: string
 *                 description: JSON-encoded array of file URIs
 *               fileNames:
 *                 type: string
 *                 description: JSON-encoded array of file names
 *     responses:
 *       200:
 *         description: Token creation transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/", authHandler.authorizeRequest(), TokensController.create);

/**
 * @openapi
 * /tokens/transfer:
 *   post:
 *     summary: Transfer tokens to another address
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *               - to
 *               - value
 *             properties:
 *               address:
 *                 type: string
 *                 description: Token contract address
 *               to:
 *                 type: string
 *                 description: Recipient address
 *               value:
 *                 type: string
 *                 description: Transfer amount (decimal string)
 *     responses:
 *       200:
 *         description: Transfer transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/transfer", authHandler.authorizeRequest(), TokensController.transfer);

/**
 * @openapi
 * /tokens/approve:
 *   post:
 *     summary: Approve a spender for token allowances
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *               - spender
 *               - value
 *             properties:
 *               address:
 *                 type: string
 *                 description: Token contract address
 *               spender:
 *                 type: string
 *                 description: Spender address
 *               value:
 *                 type: string
 *                 description: Allowance amount (decimal string)
 *     responses:
 *       200:
 *         description: Approval transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/approve", authHandler.authorizeRequest(), TokensController.approve);

/**
 * @openapi
 * /tokens/transferFrom:
 *   post:
 *     summary: Transfer tokens on behalf of another address
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *               - from
 *               - to
 *               - value
 *             properties:
 *               address:
 *                 type: string
 *                 description: Token contract address
 *               from:
 *                 type: string
 *                 description: Source address
 *               to:
 *                 type: string
 *                 description: Recipient address
 *               value:
 *                 type: string
 *                 description: Transfer amount (decimal string)
 *     responses:
 *       200:
 *         description: Transfer transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/transferFrom", authHandler.authorizeRequest(), TokensController.transferFrom);

/**
 * @openapi
 * /tokens/setStatus:
 *   post:
 *     summary: Update a token's status (admin)
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *               - status
 *             properties:
 *               address:
 *                 type: string
 *               status:
 *                 type: integer
 *                 enum: [1, 2, 3]
 *                 description: 1=PENDING, 2=ACTIVE, 3=LEGACY
 *     responses:
 *       200:
 *         description: Status update transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/setStatus", authHandler.authorizeRequest(), TokensController.setStatus);

export default router;