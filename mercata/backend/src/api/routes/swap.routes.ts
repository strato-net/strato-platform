import { Router } from "express";
import authHandler from "../middleware/authHandler";
import SwappingController from "../controllers/swapping.controller";

const router = Router();

// ----- Pool Discovery & Information -----
// Get all pools (with optional filtering)
router.get("/swap-pools", authHandler.authorizeRequest(true), SwappingController.getAll);

// Get all swappable tokens across all pools
router.get("/swap-pools/tokens", authHandler.authorizeRequest(true), SwappingController.getSwapableTokens);

// Get token pairs that can be swapped with a specific token
router.get("/swap-pools/tokens/:tokenAddress", authHandler.authorizeRequest(true), SwappingController.getSwapableTokenPairs);

// Get user's LP token positions (pools they have liquidity in)
router.get("/swap-pools/positions", authHandler.authorizeRequest(true), SwappingController.getLPTokens);

// Get specific pool by token pair addresses
router.get("/swap-pools/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);

// Get specific pool by pool address
router.get("/swap-pools/:poolAddress", authHandler.authorizeRequest(true), SwappingController.get);

// Create new pool
router.post("/swap-pools", authHandler.authorizeRequest(), SwappingController.create);

// ----- Liquidity Management -----
// Add liquidity to a specific pool (dual token)
router.post("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.addLiquidityDualToken);

// Add liquidity to a specific pool (single token)
router.post("/swap-pools/:poolAddress/liquidity/single", authHandler.authorizeRequest(), SwappingController.addLiquiditySingleToken);

// Remove liquidity from a specific pool
router.delete("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.removeLiquidity);

// ----- Swap Operations -----
// Execute swap transaction
router.post("/swap", authHandler.authorizeRequest(), SwappingController.swap);

// ----- Swap History -----
// Get swap history for a specific pool (with optional query parameters)
// Query params: select, order, offset, limit, block_timestamp, transaction_hash, etc.
router.get("/swap-history/:poolAddress", authHandler.authorizeRequest(true), SwappingController.getSwapHistory);

// ----- Admin Operations -----
// Set pool rates (admin only)
router.post("/swap-pools/set-rates", authHandler.authorizeRequest(), SwappingController.setPoolRates);

export default router;