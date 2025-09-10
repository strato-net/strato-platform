import { Router } from "express";
import authHandler from "../middleware/authHandler";
import CDPController from "../controllers/cdp.controller";

const router = Router();

// ----- Vault Information -----
// Get user's CDP vaults
router.get("/vaults", authHandler.authorizeRequest(), CDPController.getVaults);

// Get vault details for specific collateral asset
router.get("/vaults/:asset", authHandler.authorizeRequest(), CDPController.getVault);

// ----- Vault Operations -----
// Deposit collateral
router.post("/deposit", authHandler.authorizeRequest(), CDPController.deposit);

// Withdraw collateral  
router.post("/withdraw", authHandler.authorizeRequest(), CDPController.withdraw);

// Get maximum mintable amount (simulation)
router.post("/get-max-mint", authHandler.authorizeRequest(), CDPController.getMaxMint);

// Mint USDST
router.post("/mint", authHandler.authorizeRequest(), CDPController.mint);

// Repay USDST debt
router.post("/repay", authHandler.authorizeRequest(), CDPController.repay);

// ----- Helper Functions -----
// Get maximum withdrawable amount (simulation)
router.post("/get-max-withdraw", authHandler.authorizeRequest(), CDPController.getMaxWithdraw);

// Withdraw maximum safe collateral
router.post("/withdraw-max", authHandler.authorizeRequest(), CDPController.withdrawMax);

// Mint maximum safe USDST
router.post("/mint-max", authHandler.authorizeRequest(), CDPController.mintMax);

// Repay all debt for an asset
router.post("/repay-all", authHandler.authorizeRequest(), CDPController.repayAll);

// ----- Liquidation -----
// Execute liquidation
router.post("/liquidate", authHandler.authorizeRequest(), CDPController.liquidate);

// Get liquidatable positions
router.get("/liquidatable", authHandler.authorizeRequest(), CDPController.getLiquidatable);

// Get maximum liquidatable amount for a position
router.post("/max-liquidatable", authHandler.authorizeRequest(), CDPController.getMaxLiquidatable);

// ----- Configuration -----
// Get collateral asset configuration
router.get("/config/:asset", authHandler.authorizeRequest(true), CDPController.getAssetConfig);

// Get all supported assets
router.get("/assets", authHandler.authorizeRequest(true), CDPController.getSupportedAssets);

// Get asset debt information for validation
router.post("/asset-debt-info", authHandler.authorizeRequest(), CDPController.getAssetDebtInfo);

// ----- Admin Routes (Owner Only) -----
// Set collateral asset configuration
router.post("/admin/set-collateral-config", authHandler.authorizeRequest(true), CDPController.setCollateralConfig);

// Toggle asset pause status
router.post("/admin/set-asset-paused", authHandler.authorizeRequest(true), CDPController.setAssetPaused);

// Set global pause status
router.post("/admin/set-global-paused", authHandler.authorizeRequest(true), CDPController.setGlobalPaused);

// Get global pause status
router.get("/admin/global-paused", authHandler.authorizeRequest(true), CDPController.getGlobalPaused);

// Get all collateral configurations (admin view)
router.get("/admin/all-configs", authHandler.authorizeRequest(true), CDPController.getAllCollateralConfigs);

export default router;
