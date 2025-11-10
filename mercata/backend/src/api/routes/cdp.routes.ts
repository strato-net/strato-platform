import { Router } from "express";
import authHandler from "../middleware/authHandler";
import CDPController from "../controllers/cdp.controller";

const router = Router();

/**
 * @openapi
 * /cdp/vaults:
 *   get:
 *     summary: List CDP vaults for the signed-in user
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Vault collection
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/vaults", authHandler.authorizeRequest(), CDPController.getVaults);

/**
 * @openapi
 * /cdp/vaults/{asset}:
 *   get:
 *     summary: Fetch a single vault for an asset
 *     tags: [CDP]
 *     parameters:
 *       - name: asset
 *         in: path
 *         required: true
 *         description: Collateral token address
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vault information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/vaults/:asset", authHandler.authorizeRequest(), CDPController.getVault);

/**
 * @openapi
 * /cdp/deposit:
 *   post:
 *     summary: Deposit collateral into a vault
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *               amount:
 *                 type: string
 *                 description: Amount to deposit (decimal string)
 *     responses:
 *       200:
 *         description: Deposit transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/deposit", authHandler.authorizeRequest(), CDPController.deposit);

/**
 * @openapi
 * /cdp/withdraw:
 *   post:
 *     summary: Withdraw collateral from a vault
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *               amount:
 *                 type: string
 *                 description: Amount to withdraw (decimal string)
 *     responses:
 *       200:
 *         description: Withdrawal transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/withdraw", authHandler.authorizeRequest(), CDPController.withdraw);

/**
 * @openapi
 * /cdp/get-max-mint:
 *   post:
 *     summary: Calculate maximum mintable USDST
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Maximum USDST amount
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maxAmount:
 *                   type: string
 */
router.post("/get-max-mint", authHandler.authorizeRequest(), CDPController.getMaxMint);

/**
 * @openapi
 * /cdp/mint:
 *   post:
 *     summary: Mint USDST against collateral
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: USDST amount to mint (decimal string)
 *     responses:
 *       200:
 *         description: Mint transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/mint", authHandler.authorizeRequest(), CDPController.mint);

/**
 * @openapi
 * /cdp/repay:
 *   post:
 *     summary: Repay outstanding USDST debt
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: USDST amount to repay (decimal string)
 *     responses:
 *       200:
 *         description: Repayment transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/repay", authHandler.authorizeRequest(), CDPController.repay);

/**
 * @openapi
 * /cdp/get-max-withdraw:
 *   post:
 *     summary: Calculate maximum withdrawable collateral
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Maximum withdrawable amount
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maxAmount:
 *                   type: string
 */
router.post("/get-max-withdraw", authHandler.authorizeRequest(), CDPController.getMaxWithdraw);

/**
 * @openapi
 * /cdp/withdraw-max:
 *   post:
 *     summary: Withdraw the maximum safe collateral
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Withdrawal transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/withdraw-max", authHandler.authorizeRequest(), CDPController.withdrawMax);

/**
 * @openapi
 * /cdp/mint-max:
 *   post:
 *     summary: Mint the maximum safe USDST
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Mint transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/mint-max", authHandler.authorizeRequest(), CDPController.mintMax);

/**
 * @openapi
 * /cdp/repay-all:
 *   post:
 *     summary: Repay all debt for a vault
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Repayment transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/repay-all", authHandler.authorizeRequest(), CDPController.repayAll);

/**
 * @openapi
 * /cdp/liquidate:
 *   post:
 *     summary: Liquidate an unhealthy position
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - collateralAsset
 *               - borrower
 *               - debtToCover
 *             properties:
 *               collateralAsset:
 *                 type: string
 *                 description: Collateral asset address
 *               borrower:
 *                 type: string
 *                 description: Borrower address to liquidate
 *               debtToCover:
 *                 type: string
 *                 description: USDST amount to cover (decimal string)
 *     responses:
 *       200:
 *         description: Liquidation transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/liquidate", authHandler.authorizeRequest(), CDPController.liquidate);

/**
 * @openapi
 * /cdp/liquidatable:
 *   get:
 *     summary: List liquidatable positions
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Liquidatable vaults
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/liquidatable", authHandler.authorizeRequest(), CDPController.getLiquidatable);

/**
 * @openapi
 * /cdp/max-liquidatable:
 *   post:
 *     summary: Calculate maximum liquidatable debt
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - collateralAsset
 *               - borrower
 *             properties:
 *               collateralAsset:
 *                 type: string
 *               borrower:
 *                 type: string
 *     responses:
 *       200:
 *         description: Maximum repayable amount
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maxAmount:
 *                   type: string
 */
router.post("/max-liquidatable", authHandler.authorizeRequest(), CDPController.getMaxLiquidatable);

/**
 * @openapi
 * /cdp/config/{asset}:
 *   get:
 *     summary: Read the collateral configuration for an asset
 *     tags: [CDP]
 *     parameters:
 *       - name: asset
 *         in: path
 *         required: true
 *         description: Collateral token address
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Collateral configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/config/:asset", authHandler.authorizeRequest(true), CDPController.getAssetConfig);

/**
 * @openapi
 * /cdp/assets:
 *   get:
 *     summary: List supported collateral assets
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Supported asset configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/assets", authHandler.authorizeRequest(true), CDPController.getSupportedAssets);

/**
 * @openapi
 * /cdp/asset-debt-info:
 *   post:
 *     summary: Retrieve global debt metrics for an asset
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *     responses:
 *       200:
 *         description: Asset debt information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentTotalDebt:
 *                   type: string
 *                 debtFloor:
 *                   type: string
 *                 debtCeiling:
 *                   type: string
 */
router.post("/asset-debt-info", authHandler.authorizeRequest(), CDPController.getAssetDebtInfo);

/**
 * @openapi
 * /cdp/admin/set-collateral-config:
 *   post:
 *     summary: Update collateral parameters (admin)
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - liquidationRatio
 *               - liquidationPenaltyBps
 *               - closeFactorBps
 *               - stabilityFeeRate
 *               - debtFloor
 *               - debtCeiling
 *               - unitScale
 *               - isPaused
 *             properties:
 *               asset:
 *                 type: string
 *               liquidationRatio:
 *                 type: string
 *                 description: Liquidation ratio in WAD format
 *               liquidationPenaltyBps:
 *                 type: integer
 *               closeFactorBps:
 *                 type: integer
 *               stabilityFeeRate:
 *                 type: string
 *                 description: Stability fee in RAY format
 *               debtFloor:
 *                 type: string
 *               debtCeiling:
 *                 type: string
 *               unitScale:
 *                 type: string
 *               isPaused:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Configuration transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/set-collateral-config", authHandler.authorizeRequest(true), CDPController.setCollateralConfig);

/**
 * @openapi
 * /cdp/admin/set-asset-paused:
 *   post:
 *     summary: Toggle pause for a collateral asset (admin)
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - isPaused
 *             properties:
 *               asset:
 *                 type: string
 *               isPaused:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Pause transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/set-asset-paused", authHandler.authorizeRequest(true), CDPController.setAssetPaused);

/**
 * @openapi
 * /cdp/admin/set-global-paused:
 *   post:
 *     summary: Toggle global CDP pause (admin)
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isPaused
 *             properties:
 *               isPaused:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Global pause transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/set-global-paused", authHandler.authorizeRequest(true), CDPController.setGlobalPaused);

/**
 * @openapi
 * /cdp/admin/global-paused:
 *   get:
 *     summary: Check whether the CDP engine is paused
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Pause status flag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isPaused:
 *                   type: boolean
 */
router.get("/admin/global-paused", authHandler.authorizeRequest(true), CDPController.getGlobalPaused);

/**
 * @openapi
 * /cdp/admin/all-configs:
 *   get:
 *     summary: List all collateral configurations (admin)
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Collateral configuration list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/admin/all-configs", authHandler.authorizeRequest(true), CDPController.getAllCollateralConfigs);

/**
 * @openapi
 * /cdp/bad-debt:
 *   get:
 *     summary: Retrieve bad-debt balances per asset
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Bad-debt entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/bad-debt", authHandler.authorizeRequest(), CDPController.getBadDebt);

/**
 * @openapi
 * /cdp/bad-debt/juniors/{account}:
 *   get:
 *     summary: List junior notes for an account
 *     tags: [CDP]
 *     parameters:
 *       - name: account
 *         in: path
 *         required: true
 *         description: Account address to inspect
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Junior note positions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/bad-debt/juniors/:account", authHandler.authorizeRequest(), CDPController.getJuniorNotes);

/**
 * @openapi
 * /cdp/bad-debt/open-junior-note:
 *   post:
 *     summary: Open a junior note position
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amountUSDST
 *             properties:
 *               asset:
 *                 type: string
 *               amountUSDST:
 *                 type: string
 *                 description: USDST contribution (decimal string)
 *     responses:
 *       200:
 *         description: Junior note transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/bad-debt/open-junior-note", authHandler.authorizeRequest(), CDPController.openJuniorNote);

/**
 * @openapi
 * /cdp/bad-debt/top-up-junior-note:
 *   post:
 *     summary: Top up the active junior note
 *     tags: [CDP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountUSDST
 *             properties:
 *               amountUSDST:
 *                 type: string
 *                 description: Additional USDST to contribute (decimal string)
 *     responses:
 *       200:
 *         description: Junior note transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/bad-debt/top-up-junior-note", authHandler.authorizeRequest(), CDPController.topUpJuniorNote);

/**
 * @openapi
 * /cdp/bad-debt/claim-junior-note:
 *   post:
 *     summary: Claim proceeds from the junior note
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Claim transaction result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/bad-debt/claim-junior-note", authHandler.authorizeRequest(), CDPController.claimJuniorNote);

/**
 * @openapi
 * /cdp/stats:
 *   get:
 *     summary: Get aggregated CDP statistics by asset
 *     tags: [CDP]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: CDP statistics aggregated by asset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalCollateralValueUSD:
 *                   type: string
 *                   description: Total collateral value across all CDPs in USD
 *                 totalDebtUSD:
 *                   type: string
 *                   description: Total debt across all CDPs in USD
 *                 globalCollateralizationRatio:
 *                   type: number
 *                   description: Global collateralization ratio as percentage (collateral / debt * 100)
 *                 assets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       asset:
 *                         type: string
 *                         description: Asset contract address
 *                       symbol:
 *                         type: string
 *                         description: Asset symbol (e.g., WBTC, ETHST)
 *                       totalCollateral:
 *                         type: string
 *                         description: Total collateral amount (raw integer string)
 *                       totalScaledDebt:
 *                         type: string
 *                         description: Total scaled debt amount
 *                       totalDebtUSD:
 *                         type: string
 *                         description: Total debt in USD for this asset
 *                       collateralValueUSD:
 *                         type: string
 *                         description: Total collateral value in USD for this asset
 *                       collateralizationRatio:
 *                         type: number
 *                         description: Collateralization ratio as percentage (collateral / debt * 100)
 *                       numberOfVaults:
 *                         type: integer
 *                         description: Number of vaults for this asset
 */
router.get("/stats", authHandler.authorizeRequest(), CDPController.getCDPStats);

export default router;
