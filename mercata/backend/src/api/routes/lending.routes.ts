import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LendingController from "../controllers/lending.controller";

const router = Router();

// ----- Pool Information -----
// Get lending pool information
router.get("/pools", authHandler.authorizeRequest(true), LendingController.get);
 
// New: Helper actions
router.post("/loans/borrow-max", authHandler.authorizeRequest(), LendingController.borrowMax);
router.post("/collateral/withdraw-max", authHandler.authorizeRequest(), LendingController.withdrawCollateralMax);

// ----- User Balances & Positions -----
// Get user's collateral and balance information
router.get("/collateral", authHandler.authorizeRequest(), LendingController.getCollateralAndBalance);
 
// Get user's liquidity and balance information
router.get("/liquidity", authHandler.authorizeRequest(), LendingController.getLiquidityAndBalance);

// Get user's loans
router.get("/loans", authHandler.authorizeRequest(), LendingController.getLoans);

// ----- Liquidity Management -----
// Deposit liquidity to the lending pool
router.post("/pools/liquidity", authHandler.authorizeRequest(), LendingController.depositLiquidity);

// Withdraw liquidity from the lending pool
router.delete("/pools/liquidity", authHandler.authorizeRequest(), LendingController.withdrawLiquidity);
// Withdraw all liquidity (no dust)
router.post("/pools/withdraw-all", authHandler.authorizeRequest(), LendingController.withdrawLiquidityAll);

// ----- Collateral Management -----
// Supply collateral
router.post("/collateral", authHandler.authorizeRequest(), LendingController.supplyCollateral);

// Withdraw collateral
router.delete("/collateral", authHandler.authorizeRequest(), LendingController.withdrawCollateral);

// ----- Loan Operations -----
// Borrow from the lending pool
router.post("/loans", authHandler.authorizeRequest(), LendingController.borrow);

// Repay loan
router.patch("/loans", authHandler.authorizeRequest(), LendingController.repay);

// Repay all
router.post("/loans/repay-all", authHandler.authorizeRequest(), LendingController.repayAll);

// ----- Liquidation Data (Listing) -----
// Get currently liquidatable loans
router.get("/liquidate", authHandler.authorizeRequest(), LendingController.listLiquidatable);

// Get near-unhealthy loans (query param margin=x)
router.get("/liquidate/near-unhealthy", authHandler.authorizeRequest(), LendingController.listNearUnhealthy);

// ----- Liquidation Management -----
// Execute liquidation on a specific loan (singular alias for UI compatibility)
router.post("/liquidate/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);
// Existing plural route retained for backward compatibility
router.post("/liquidations/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

// ----- Admin Configuration -----
// Configure asset with all parameters
router.post("/admin/configure-asset", authHandler.authorizeRequest(), LendingController.configureAsset);

// Sweep protocol reserves to fee collector
router.post("/admin/sweep-reserves", authHandler.authorizeRequest(), LendingController.sweepReserves);

// Set debt ceilings for protocol risk management
router.post("/admin/set-debt-ceilings", authHandler.authorizeRequest(), LendingController.setDebtCeilings);

export default router; 