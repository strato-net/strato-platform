import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EarnController from "../controllers/earn.controller";
import SaveUsdstController from "../controllers/saveUsdst.controller";

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

router.get("/save-usdst/info", authHandler.authorizeRequest(true), SaveUsdstController.getInfo);
router.get("/save-usdst/user", authHandler.authorizeRequest(), SaveUsdstController.getUserInfo);
router.post("/save-usdst/deposit", authHandler.authorizeRequest(), SaveUsdstController.deposit);
router.post("/save-usdst/redeem", authHandler.authorizeRequest(), SaveUsdstController.redeem);
router.post("/save-usdst/redeem-all", authHandler.authorizeRequest(), SaveUsdstController.redeemAll);

export default router;
