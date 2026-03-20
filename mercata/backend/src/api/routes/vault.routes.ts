import { Router } from "express";
import authHandler from "../middleware/authHandler";
import VaultController from "../controllers/vault.controller";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// USER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /vault/info:
 *   get:
 *     summary: Get vault global state
 *     description: Retrieve the vault's global state including total equity, withdrawable equity, NAV per share, and per-asset data
 *     tags:
 *       - Vault
 *     responses:
 *       200:
 *         description: Vault info retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalEquity:
 *                   type: string
 *                   description: Total vault equity in USD (18 decimals)
 *                 withdrawableEquity:
 *                   type: string
 *                   description: Withdrawable equity in USD (18 decimals)
 *                 totalShares:
 *                   type: string
 *                   description: Total vault shares (18 decimals)
 *                 navPerShare:
 *                   type: string
 *                   description: NAV per share in USD (18 decimals)
 *                 apy:
 *                   type: string
 *                   description: APY as decimal
 *                 paused:
 *                   type: boolean
 *                   description: Whether the vault is paused
 *                 assets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 *                       balance:
 *                         type: string
 *                       minReserve:
 *                         type: string
 *                       withdrawable:
 *                         type: string
 *                       priceUsd:
 *                         type: string
 *                       valueUsd:
 *                         type: string
 *                 deficitAssets:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Array of asset addresses below minimum reserve
 *                 shareTokenSymbol:
 *                   type: string
 *                 shareTokenAddress:
 *                   type: string
 *                 botExecutor:
 *                   type: string
 */
router.get("/info", authHandler.authorizeRequest(true), VaultController.getInfo);

/**
 * @openapi
 * /vault/user:
 *   get:
 *     summary: Get user's vault position
 *     description: Retrieve the authenticated user's position in the vault
 *     tags:
 *       - Vault
 *     responses:
 *       200:
 *         description: User position retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userShares:
 *                   type: string
 *                   description: User's vault shares (18 decimals)
 *                 userValueUsd:
 *                   type: string
 *                   description: User's position value in USD (18 decimals)
 *                 allTimeDeposits:
 *                   type: string
 *                   description: User's all-time total deposits in USD (18 decimals)
 *                 allTimeEarnings:
 *                   type: string
 *                   description: User's all-time earnings/losses in USD (18 decimals, can be negative)
 */
router.get("/user", authHandler.authorizeRequest(), VaultController.getUserPosition);

/**
 * @openapi
 * /vault/balances:
 *   get:
 *     summary: Get user's token balances for vault assets
 *     description: Retrieve the authenticated user's balances for all supported vault assets. Only returns tokens where the user has a positive balance.
 *     tags:
 *       - Vault
 *     responses:
 *       200:
 *         description: User balances retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 balances:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                         description: Token contract address
 *                       symbol:
 *                         type: string
 *                         description: Token symbol
 *                       name:
 *                         type: string
 *                         description: Token name
 *                       balance:
 *                         type: string
 *                         description: User's balance (18 decimals)
 *                       priceUsd:
 *                         type: string
 *                         description: Current price in USD (18 decimals)
 *                       images:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             value:
 *                               type: string
 */
router.get("/balances", authHandler.authorizeRequest(), VaultController.getBalances);

/**
 * @openapi
 * /vault/transactions:
 *   get:
 *     summary: Get bot swap transactions
 *     description: Retrieve recent swap transactions executed by the vault's bot
 *     tags:
 *       - Vault
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of transactions to return
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [swap]
 *                       timestamp:
 *                         type: string
 *                       tokenIn:
 *                         type: object
 *                         properties:
 *                           address:
 *                             type: string
 *                           symbol:
 *                             type: string
 *                           amount:
 *                             type: string
 *                       tokenOut:
 *                         type: object
 *                         properties:
 *                           address:
 *                             type: string
 *                           symbol:
 *                             type: string
 *                           amount:
 *                             type: string
 */
router.get("/transactions", authHandler.authorizeRequest(true), VaultController.getTransactions);

/**
 * @openapi
 * /vault/deposit:
 *   post:
 *     summary: Deposit tokens into the vault
 *     description: Deposit a supported token into the vault and receive vault shares
 *     tags:
 *       - Vault
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - amount
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token contract address
 *               amount:
 *                 type: string
 *                 description: Amount to deposit (18 decimals)
 *     responses:
 *       200:
 *         description: Deposit transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/deposit", authHandler.authorizeRequest(), VaultController.deposit);

/**
 * @openapi
 * /vault/withdraw/preview:
 *   get:
 *     summary: Preview withdrawal basket
 *     description: Get a preview of the tokens that would be received for a given withdrawal amount
 *     tags:
 *       - Vault
 *     parameters:
 *       - in: query
 *         name: amountUsd
 *         required: true
 *         schema:
 *           type: string
 *         description: USD value to preview (18 decimals)
 *     responses:
 *       200:
 *         description: Withdrawal basket preview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 basket:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 *                       weightPercent:
 *                         type: string
 *                       usdValue:
 *                         type: string
 *                       tokenAmount:
 *                         type: string
 *                       included:
 *                         type: boolean
 */
router.get("/withdraw/preview", authHandler.authorizeRequest(), VaultController.withdrawPreview);

/**
 * @openapi
 * /vault/withdraw:
 *   post:
 *     summary: Withdraw from the vault
 *     description: Withdraw by specifying USD value to redeem. Payouts are drawn proportionally from withdrawable assets.
 *     tags:
 *       - Vault
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountUsd
 *             properties:
 *               amountUsd:
 *                 type: string
 *                 description: USD value to withdraw (18 decimals)
 *     responses:
 *       200:
 *         description: Withdrawal transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 *                 basket:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       token:
 *                         type: string
 *                       amount:
 *                         type: string
 */
router.post("/withdraw", authHandler.authorizeRequest(), VaultController.withdraw);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /vault/admin/pause:
 *   post:
 *     summary: Pause the vault (admin only)
 *     description: Pause the vault to block deposits and withdrawals
 *     tags:
 *       - Vault Admin
 *     responses:
 *       200:
 *         description: Pause transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/admin/pause", authHandler.authorizeRequest(), VaultController.pause);

/**
 * @openapi
 * /vault/admin/unpause:
 *   post:
 *     summary: Unpause the vault (admin only)
 *     description: Unpause the vault to allow deposits and withdrawals
 *     tags:
 *       - Vault Admin
 *     responses:
 *       200:
 *         description: Unpause transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/admin/unpause", authHandler.authorizeRequest(), VaultController.unpause);

/**
 * @openapi
 * /vault/admin/reserves:
 *   post:
 *     summary: Set minimum reserve for an asset (admin only)
 *     description: Configure the minimum reserve amount for a supported asset
 *     tags:
 *       - Vault Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - minReserve
 *             properties:
 *               token:
 *                 type: string
 *                 description: Asset contract address
 *               minReserve:
 *                 type: string
 *                 description: New minimum reserve amount (18 decimals)
 *     responses:
 *       200:
 *         description: Set reserve transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/admin/reserves", authHandler.authorizeRequest(), VaultController.setMinReserve);

/**
 * @openapi
 * /vault/admin/executor:
 *   post:
 *     summary: Set bot executor address (admin only)
 *     description: Update the bot executor address that holds vault assets
 *     tags:
 *       - Vault Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - executor
 *             properties:
 *               executor:
 *                 type: string
 *                 description: New bot executor address
 *     responses:
 *       200:
 *         description: Set executor transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/admin/executor", authHandler.authorizeRequest(), VaultController.setBotExecutor);

/**
 * @openapi
 * /vault/admin/assets:
 *   post:
 *     summary: Add a supported asset (admin only)
 *     description: Add a new asset to the vault's supported assets list
 *     tags:
 *       - Vault Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Asset contract address to add
 *     responses:
 *       200:
 *         description: Add asset transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.post("/admin/assets", authHandler.authorizeRequest(), VaultController.addAsset);

/**
 * @openapi
 * /vault/admin/assets:
 *   delete:
 *     summary: Remove a supported asset (admin only)
 *     description: Remove an asset from the vault's supported assets list. Asset must have zero balance.
 *     tags:
 *       - Vault Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: Asset contract address to remove
 *     responses:
 *       200:
 *         description: Remove asset transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 hash:
 *                   type: string
 */
router.delete("/admin/assets", authHandler.authorizeRequest(), VaultController.removeAsset);

export default router;
