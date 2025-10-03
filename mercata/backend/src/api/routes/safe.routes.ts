import { Router } from "express";
import SafeController from "../controllers/safe.controller";
import authHandler from "../middleware/authHandler";

const router = Router();

/**
 * GET /api/safe/liquidity/:chainId/:tokenAddress
 * Fetches the Safe wallet balance for a specific ERC-20 token on an external chain
 * 
 * @param chainId - External chain ID (e.g., 11155111 for Sepolia)
 * @param tokenAddress - ERC-20 token contract address
 * @returns Balance information including wei and formatted values
 */
router.get("/liquidity/:chainId/:tokenAddress", authHandler.authorizeRequest(true), SafeController.getLiquidity);

export default router;

