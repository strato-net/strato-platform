import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LendingController from "../controllers/lending.controller";
import SafetyController from "../controllers/safety.controller";

const router = Router();

/**
 * @openapi
 * /lending/pools:
 *   get:
 *     summary: Get lending pool information
 *     tags: [Lending]
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
router.get("/pools", authHandler.authorizeRequest(true), LendingController.get);
 
/**
 * @openapi
 * /lending/loans/borrow-max:
 *   post:
 *     summary: Borrow maximum amount
 *     tags: [Lending]
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
router.post("/loans/borrow-max", authHandler.authorizeRequest(), LendingController.borrowMax);

/**
 * @openapi
 * /lending/collateral/withdraw-max:
 *   post:
 *     summary: Withdraw maximum collateral
 *     tags: [Lending]
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
router.post("/collateral/withdraw-max", authHandler.authorizeRequest(), LendingController.withdrawCollateralMax);

/**
 * @openapi
 * /lending/collateral:
 *   get:
 *     summary: Get user's collateral and balance
 *     tags: [Lending]
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
 *   post:
 *     summary: Supply collateral
 *     tags: [Lending]
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
 *   delete:
 *     summary: Withdraw collateral
 *     tags: [Lending]
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
router.get("/collateral", authHandler.authorizeRequest(), LendingController.getCollateralAndBalance);
router.post("/collateral", authHandler.authorizeRequest(), LendingController.supplyCollateral);
router.delete("/collateral", authHandler.authorizeRequest(), LendingController.withdrawCollateral);
 
/**
 * @openapi
 * /lending/liquidity:
 *   get:
 *     summary: Get user's liquidity and balance
 *     tags: [Lending]
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
router.get("/liquidity", authHandler.authorizeRequest(), LendingController.getLiquidityAndBalance);

/**
 * @openapi
 * /lending/loans:
 *   get:
 *     summary: Get user's loans
 *     tags: [Lending]
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
 *     summary: Borrow from lending pool
 *     tags: [Lending]
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
 *   patch:
 *     summary: Repay loan
 *     tags: [Lending]
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
router.get("/loans", authHandler.authorizeRequest(), LendingController.getLoans);
router.post("/loans", authHandler.authorizeRequest(), LendingController.borrow);
router.patch("/loans", authHandler.authorizeRequest(), LendingController.repay);

/**
 * @openapi
 * /lending/pools/liquidity:
 *   post:
 *     summary: Deposit liquidity to lending pool
 *     tags: [Lending]
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
 *   delete:
 *     summary: Withdraw liquidity from lending pool
 *     tags: [Lending]
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
router.post("/pools/liquidity", authHandler.authorizeRequest(), LendingController.depositLiquidity);
router.delete("/pools/liquidity", authHandler.authorizeRequest(), LendingController.withdrawLiquidity);

/**
 * @openapi
 * /lending/pools/withdraw-all:
 *   post:
 *     summary: Withdraw all liquidity
 *     tags: [Lending]
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
router.post("/pools/withdraw-all", authHandler.authorizeRequest(), LendingController.withdrawLiquidityAll);

/**
 * @openapi
 * /lending/loans/repay-all:
 *   post:
 *     summary: Repay all loans
 *     tags: [Lending]
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
router.post("/loans/repay-all", authHandler.authorizeRequest(), LendingController.repayAll);

/**
 * @openapi
 * /lending/liquidate:
 *   get:
 *     summary: Get liquidatable loans
 *     tags: [Lending]
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
router.get("/liquidate", authHandler.authorizeRequest(), LendingController.listLiquidatable);

/**
 * @openapi
 * /lending/liquidate/near-unhealthy:
 *   get:
 *     summary: Get near-unhealthy loans
 *     tags: [Lending]
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
router.get("/liquidate/near-unhealthy", authHandler.authorizeRequest(), LendingController.listNearUnhealthy);

/**
 * @openapi
 * /lending/liquidate/{id}:
 *   post:
 *     summary: Execute liquidation
 *     tags: [Lending]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Loan ID
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
router.post("/liquidate/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/**
 * @openapi
 * /lending/liquidations/{id}:
 *   post:
 *     summary: Execute liquidation (legacy)
 *     tags: [Lending]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Loan ID
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
router.post("/liquidations/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/**
 * @openapi
 * /lending/admin/configure-asset:
 *   post:
 *     summary: Configure asset (admin)
 *     tags: [Lending]
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
router.post("/admin/configure-asset", authHandler.authorizeRequest(), LendingController.configureAsset);

/**
 * @openapi
 * /lending/admin/sweep-reserves:
 *   post:
 *     summary: Sweep protocol reserves (admin)
 *     tags: [Lending]
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
router.post("/admin/sweep-reserves", authHandler.authorizeRequest(), LendingController.sweepReserves);

/**
 * @openapi
 * /lending/admin/set-debt-ceilings:
 *   post:
 *     summary: Set debt ceilings (admin)
 *     tags: [Lending]
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
router.post("/admin/set-debt-ceilings", authHandler.authorizeRequest(), LendingController.setDebtCeilings);

/**
 * @openapi
 * /lending/safety/info:
 *   get:
 *     summary: Get SafetyModule info
 *     tags: [Lending]
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
router.get("/safety/info", authHandler.authorizeRequest(), SafetyController.getInfo);

/**
 * @openapi
 * /lending/safety/stake:
 *   post:
 *     summary: Stake USDST
 *     tags: [Lending]
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
router.post("/safety/stake", authHandler.authorizeRequest(), SafetyController.stake);

/**
 * @openapi
 * /lending/safety/cooldown:
 *   post:
 *     summary: Start cooldown period
 *     tags: [Lending]
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
router.post("/safety/cooldown", authHandler.authorizeRequest(), SafetyController.startCooldown);

/**
 * @openapi
 * /lending/safety/redeem:
 *   post:
 *     summary: Redeem sUSDST shares
 *     tags: [Lending]
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
router.post("/safety/redeem", authHandler.authorizeRequest(), SafetyController.redeem);

/**
 * @openapi
 * /lending/safety/redeem-all:
 *   post:
 *     summary: Redeem all sUSDST shares
 *     tags: [Lending]
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
router.post("/safety/redeem-all", authHandler.authorizeRequest(), SafetyController.redeemAll);

export default router;
