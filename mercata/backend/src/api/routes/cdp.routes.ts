import { Router } from "express";
import authHandler from "../middleware/authHandler";
import CDPController from "../controllers/cdp.controller";

const router = Router();

/**
 * @openapi
 * /cdp/vaults:
 *   get:
 *     summary: Get user CDP vaults
 *     tags: [CDP]
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
 */
router.get("/vaults", authHandler.authorizeRequest(), CDPController.getVaults);

/**
 * @openapi
 * /cdp/vaults/{asset}:
 *   get:
 *     summary: Get vault details for asset
 *     tags: [CDP]
 *     parameters:
 *       - name: asset
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
router.get("/vaults/:asset", authHandler.authorizeRequest(), CDPController.getVault);

/**
 * @openapi
 * /cdp/deposit:
 *   post:
 *     summary: Deposit collateral to vault
 *     tags: [CDP]
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
router.post("/deposit", authHandler.authorizeRequest(), CDPController.deposit);

/**
 * @openapi
 * /cdp/withdraw:
 *   post:
 *     summary: Withdraw collateral from vault
 *     tags: [CDP]
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
router.post("/withdraw", authHandler.authorizeRequest(), CDPController.withdraw);

/**
 * @openapi
 * /cdp/get-max-mint:
 *   post:
 *     summary: Get maximum mintable USDST
 *     tags: [CDP]
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
router.post("/get-max-mint", authHandler.authorizeRequest(), CDPController.getMaxMint);

/**
 * @openapi
 * /cdp/mint:
 *   post:
 *     summary: Mint USDST against collateral
 *     tags: [CDP]
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
router.post("/mint", authHandler.authorizeRequest(), CDPController.mint);

/**
 * @openapi
 * /cdp/repay:
 *   post:
 *     summary: Repay USDST debt
 *     tags: [CDP]
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
router.post("/repay", authHandler.authorizeRequest(), CDPController.repay);

/**
 * @openapi
 * /cdp/get-max-withdraw:
 *   post:
 *     summary: Get maximum withdrawable collateral
 *     tags: [CDP]
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
router.post("/get-max-withdraw", authHandler.authorizeRequest(), CDPController.getMaxWithdraw);

/**
 * @openapi
 * /cdp/withdraw-max:
 *   post:
 *     summary: Withdraw maximum safe collateral
 *     tags: [CDP]
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
router.post("/withdraw-max", authHandler.authorizeRequest(), CDPController.withdrawMax);

/**
 * @openapi
 * /cdp/mint-max:
 *   post:
 *     summary: Mint maximum safe USDST
 *     tags: [CDP]
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
router.post("/mint-max", authHandler.authorizeRequest(), CDPController.mintMax);

/**
 * @openapi
 * /cdp/repay-all:
 *   post:
 *     summary: Repay all debt for asset
 *     tags: [CDP]
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
router.post("/repay-all", authHandler.authorizeRequest(), CDPController.repayAll);

/**
 * @openapi
 * /cdp/liquidate:
 *   post:
 *     summary: Execute liquidation
 *     tags: [CDP]
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
router.post("/liquidate", authHandler.authorizeRequest(), CDPController.liquidate);

/**
 * @openapi
 * /cdp/liquidatable:
 *   get:
 *     summary: Get liquidatable positions
 *     tags: [CDP]
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
 */
router.get("/liquidatable", authHandler.authorizeRequest(), CDPController.getLiquidatable);

/**
 * @openapi
 * /cdp/max-liquidatable:
 *   post:
 *     summary: Get max liquidatable amount
 *     tags: [CDP]
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
router.post("/max-liquidatable", authHandler.authorizeRequest(), CDPController.getMaxLiquidatable);

/**
 * @openapi
 * /cdp/config/{asset}:
 *   get:
 *     summary: Get collateral asset config
 *     tags: [CDP]
 *     parameters:
 *       - name: asset
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Asset symbol
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
router.get("/config/:asset", authHandler.authorizeRequest(true), CDPController.getAssetConfig);

/**
 * @openapi
 * /cdp/assets:
 *   get:
 *     summary: Get supported assets
 *     tags: [CDP]
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
 */
router.get("/assets", authHandler.authorizeRequest(true), CDPController.getSupportedAssets);

/**
 * @openapi
 * /cdp/asset-debt-info:
 *   post:
 *     summary: Get asset debt information
 *     tags: [CDP]
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
router.post("/asset-debt-info", authHandler.authorizeRequest(), CDPController.getAssetDebtInfo);

/**
 * @openapi
 * /cdp/admin/set-collateral-config:
 *   post:
 *     summary: Set collateral config (admin)
 *     tags: [CDP]
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
router.post("/admin/set-collateral-config", authHandler.authorizeRequest(true), CDPController.setCollateralConfig);

/**
 * @openapi
 * /cdp/admin/set-asset-paused:
 *   post:
 *     summary: Set asset pause status (admin)
 *     tags: [CDP]
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
router.post("/admin/set-asset-paused", authHandler.authorizeRequest(true), CDPController.setAssetPaused);

/**
 * @openapi
 * /cdp/admin/set-global-paused:
 *   post:
 *     summary: Set global pause status (admin)
 *     tags: [CDP]
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
router.post("/admin/set-global-paused", authHandler.authorizeRequest(true), CDPController.setGlobalPaused);

/**
 * @openapi
 * /cdp/admin/global-paused:
 *   get:
 *     summary: Get global pause status
 *     tags: [CDP]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: boolean }
 */
router.get("/admin/global-paused", authHandler.authorizeRequest(true), CDPController.getGlobalPaused);

/**
 * @openapi
 * /cdp/admin/all-configs:
 *   get:
 *     summary: Get all collateral configs (admin)
 *     tags: [CDP]
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
 */
router.get("/admin/all-configs", authHandler.authorizeRequest(true), CDPController.getAllCollateralConfigs);

/**
 * @openapi
 * /cdp/bad-debt:
 *   get:
 *     summary: Get bad debt for all assets
 *     tags: [CDP]
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
router.get("/bad-debt", authHandler.authorizeRequest(), CDPController.getBadDebt);

/**
 * @openapi
 * /cdp/bad-debt/juniors/{account}:
 *   get:
 *     summary: Get junior notes for account
 *     tags: [CDP]
 *     parameters:
 *       - name: account
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Account address
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
 */
router.get("/bad-debt/juniors/:account", authHandler.authorizeRequest(), CDPController.getJuniorNotes);

/**
 * @openapi
 * /cdp/bad-debt/open-junior-note:
 *   post:
 *     summary: Open junior note
 *     tags: [CDP]
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
router.post("/bad-debt/open-junior-note", authHandler.authorizeRequest(), CDPController.openJuniorNote);

/**
 * @openapi
 * /cdp/bad-debt/top-up-junior-note:
 *   post:
 *     summary: Top up junior note
 *     tags: [CDP]
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
router.post("/bad-debt/top-up-junior-note", authHandler.authorizeRequest(), CDPController.topUpJuniorNote);

/**
 * @openapi
 * /cdp/bad-debt/claim-junior-note:
 *   post:
 *     summary: Claim junior note rewards
 *     tags: [CDP]
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
router.post("/bad-debt/claim-junior-note", authHandler.authorizeRequest(), CDPController.claimJuniorNote);

export default router;
