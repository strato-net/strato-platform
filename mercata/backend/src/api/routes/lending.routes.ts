import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LendingController from "../controllers/lending.controller";
import SafetyController from "../controllers/safety.controller";

const router = Router();

/** @openapi /lending/pools: { get: { summary: "Get lending pool information", tags: ["Lending"] } } */
router.get("/pools", authHandler.authorizeRequest(true), LendingController.get);
 
/** @openapi /lending/loans/borrow-max: { post: { summary: "Borrow maximum amount", tags: ["Lending"] } } */
router.post("/loans/borrow-max", authHandler.authorizeRequest(), LendingController.borrowMax);

/** @openapi /lending/collateral/withdraw-max: { post: { summary: "Withdraw maximum collateral", tags: ["Lending"] } } */
router.post("/collateral/withdraw-max", authHandler.authorizeRequest(), LendingController.withdrawCollateralMax);

/** @openapi /lending/collateral: { get: { summary: "Get user's collateral and balance", tags: ["Lending"] } } */
router.get("/collateral", authHandler.authorizeRequest(), LendingController.getCollateralAndBalance);
 
/** @openapi /lending/liquidity: { get: { summary: "Get user's liquidity and balance", tags: ["Lending"] } } */
router.get("/liquidity", authHandler.authorizeRequest(), LendingController.getLiquidityAndBalance);

/** @openapi /lending/loans: { get: { summary: "Get user's loans", tags: ["Lending"] }, post: { summary: "Borrow from lending pool", tags: ["Lending"] }, patch: { summary: "Repay loan", tags: ["Lending"] } } */
router.get("/loans", authHandler.authorizeRequest(), LendingController.getLoans);

/** @openapi /lending/pools/liquidity: { post: { summary: "Deposit liquidity to lending pool", tags: ["Lending"] }, delete: { summary: "Withdraw liquidity from lending pool", tags: ["Lending"] } } */
router.post("/pools/liquidity", authHandler.authorizeRequest(), LendingController.depositLiquidity);
router.delete("/pools/liquidity", authHandler.authorizeRequest(), LendingController.withdrawLiquidity);

/** @openapi /lending/pools/withdraw-all: { post: { summary: "Withdraw all liquidity", tags: ["Lending"] } } */
router.post("/pools/withdraw-all", authHandler.authorizeRequest(), LendingController.withdrawLiquidityAll);

/** @openapi /lending/collateral: { post: { summary: "Supply collateral", tags: ["Lending"] }, delete: { summary: "Withdraw collateral", tags: ["Lending"] } } */
router.post("/collateral", authHandler.authorizeRequest(), LendingController.supplyCollateral);
router.delete("/collateral", authHandler.authorizeRequest(), LendingController.withdrawCollateral);

router.post("/loans", authHandler.authorizeRequest(), LendingController.borrow);
router.patch("/loans", authHandler.authorizeRequest(), LendingController.repay);

/** @openapi /lending/loans/repay-all: { post: { summary: "Repay all loans", tags: ["Lending"] } } */
router.post("/loans/repay-all", authHandler.authorizeRequest(), LendingController.repayAll);

/** @openapi /lending/liquidate: { get: { summary: "Get liquidatable loans", tags: ["Lending"] } } */
router.get("/liquidate", authHandler.authorizeRequest(), LendingController.listLiquidatable);

/** @openapi /lending/liquidate/near-unhealthy: { get: { summary: "Get near-unhealthy loans", tags: ["Lending"] } } */
router.get("/liquidate/near-unhealthy", authHandler.authorizeRequest(), LendingController.listNearUnhealthy);

/** @openapi /lending/liquidate/{id}: { post: { summary: "Execute liquidation", tags: ["Lending"] } } */
router.post("/liquidate/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/** @openapi /lending/liquidations/{id}: { post: { summary: "Execute liquidation (legacy)", tags: ["Lending"] } } */
router.post("/liquidations/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/** @openapi /lending/admin/configure-asset: { post: { summary: "Configure asset (admin)", tags: ["Lending"] } } */
router.post("/admin/configure-asset", authHandler.authorizeRequest(), LendingController.configureAsset);

/** @openapi /lending/admin/sweep-reserves: { post: { summary: "Sweep protocol reserves (admin)", tags: ["Lending"] } } */
router.post("/admin/sweep-reserves", authHandler.authorizeRequest(), LendingController.sweepReserves);

/** @openapi /lending/admin/set-debt-ceilings: { post: { summary: "Set debt ceilings (admin)", tags: ["Lending"] } } */
router.post("/admin/set-debt-ceilings", authHandler.authorizeRequest(), LendingController.setDebtCeilings);

/** @openapi /lending/safety/info: { get: { summary: "Get SafetyModule info", tags: ["Lending"] } } */
router.get("/safety/info", authHandler.authorizeRequest(), SafetyController.getInfo);

/** @openapi /lending/safety/stake: { post: { summary: "Stake USDST", tags: ["Lending"] } } */
router.post("/safety/stake", authHandler.authorizeRequest(), SafetyController.stake);

/** @openapi /lending/safety/cooldown: { post: { summary: "Start cooldown period", tags: ["Lending"] } } */
router.post("/safety/cooldown", authHandler.authorizeRequest(), SafetyController.startCooldown);

/** @openapi /lending/safety/redeem: { post: { summary: "Redeem sUSDST shares", tags: ["Lending"] } } */
router.post("/safety/redeem", authHandler.authorizeRequest(), SafetyController.redeem);

/** @openapi /lending/safety/redeem-all: { post: { summary: "Redeem all sUSDST shares", tags: ["Lending"] } } */
router.post("/safety/redeem-all", authHandler.authorizeRequest(), SafetyController.redeemAll);

export default router;
