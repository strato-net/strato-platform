import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EarnController from "../controllers/earn.controller";

const router = Router();

/**
 * @openapi
 * /earn/token-apys:
 *   get:
 *     summary: Get APYs for all yield-bearing tokens
 *     description: "Returns all available APYs per token across 4 yield sources: lending pool, swap pools, vault, and safety module"
 *     tags:
 *       - Earn
 *     responses:
 *       200:
 *         description: Token APYs retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/token-apys", authHandler.authorizeRequest(true), EarnController.getTokenApys);

export default router;
