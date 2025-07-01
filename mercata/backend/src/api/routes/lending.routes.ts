import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LendingController from "../controllers/lending.controller";

const router = Router();

// ----- Pool Information -----
// Get lending pool information
router.get("/pools", authHandler.authorizeRequest(true), LendingController.get);

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

// ----- Liquidation Management -----
// Execute liquidation on a specific loan
router.post("/liquidations/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

// ----- Admin Configuration -----
// Set interest rate for an asset
router.post("/admin/interest-rate", authHandler.authorizeRequest(), LendingController.setInterestRate);

// Set collateral ratio for an asset
router.post("/admin/collateral-ratio", authHandler.authorizeRequest(), LendingController.setCollateralRatio);

// Set liquidation bonus for an asset
router.post("/admin/liquidation-bonus", authHandler.authorizeRequest(), LendingController.setLiquidationBonus);

export default router; 