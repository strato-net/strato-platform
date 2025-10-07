import { Router } from "express";
import authHandler from "../middleware/authHandler";
import SwappingController from "../controllers/swapping.controller";

const router = Router();

/** @openapi /swap-pools: { get: { summary: "Get all swap pools", tags: ["Swap"] }, post: { summary: "Create new swap pool", tags: ["Swap"] } } */
router.get("/swap-pools", authHandler.authorizeRequest(true), SwappingController.getAll);
router.post("/swap-pools", authHandler.authorizeRequest(), SwappingController.create);

/** @openapi /swap-pools/tokens: { get: { summary: "Get all swappable tokens", tags: ["Swap"] } } */
router.get("/swap-pools/tokens", authHandler.authorizeRequest(), SwappingController.getSwapableTokens);

/** @openapi /swap-pools/tokens/{tokenAddress}: { get: { summary: "Get swappable token pairs", tags: ["Swap"] } } */
router.get("/swap-pools/tokens/:tokenAddress", authHandler.authorizeRequest(), SwappingController.getSwapableTokenPairs);

/** @openapi /swap-pools/positions: { get: { summary: "Get user LP token positions", tags: ["Swap"] } } */
router.get("/swap-pools/positions", authHandler.authorizeRequest(), SwappingController.getUserLiquidityPools);

/** @openapi /swap-pools/{tokenAddress1}/{tokenAddress2}: { get: { summary: "Get pool by token pair", tags: ["Swap"] } } */
router.get("/swap-pools/:tokenAddress1/:tokenAddress2", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);

/** @openapi /swap-pools/{poolAddress}: { get: { summary: "Get pool by address", tags: ["Swap"] } } */
router.get("/swap-pools/:poolAddress", authHandler.authorizeRequest(true), SwappingController.get);

/** @openapi /swap-pools/{poolAddress}/liquidity: { post: { summary: "Add liquidity (dual token)", tags: ["Swap"] }, delete: { summary: "Remove liquidity from pool", tags: ["Swap"] } } */
router.post("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.addLiquidityDualToken);
router.delete("/swap-pools/:poolAddress/liquidity", authHandler.authorizeRequest(), SwappingController.removeLiquidity);

/** @openapi /swap-pools/{poolAddress}/liquidity/single: { post: { summary: "Add liquidity (single token)", tags: ["Swap"] } } */
router.post("/swap-pools/:poolAddress/liquidity/single", authHandler.authorizeRequest(), SwappingController.addLiquiditySingleToken);

/** @openapi /swap: { post: { summary: "Execute token swap", tags: ["Swap"] } } */
router.post("/swap", authHandler.authorizeRequest(), SwappingController.swap);

/** @openapi /swap-history/{poolAddress}: { get: { summary: "Get swap history for a pool", tags: ["Swap"] } } */
router.get("/swap-history/:poolAddress", authHandler.authorizeRequest(true), SwappingController.getSwapHistory);

/** @openapi /swap-pools/set-rates: { post: { summary: "Set pool rates (admin)", tags: ["Swap"] } } */
router.post("/swap-pools/set-rates", authHandler.authorizeRequest(), SwappingController.setPoolRates);

export default router;
