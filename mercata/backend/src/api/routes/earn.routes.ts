import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EarnController from "../controllers/earn.controller";
import SaveUsdstController from "../controllers/saveUsdst.controller";
import YieldVaultController from "../controllers/yieldVault.controller";

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

router.get("/yield-vault", authHandler.authorizeRequest(true), YieldVaultController.list);
router.get("/yield-vault/:key/info", authHandler.authorizeRequest(true), YieldVaultController.getInfo);
router.get("/yield-vault/:key/user", authHandler.authorizeRequest(), YieldVaultController.getUserInfo);
router.post("/yield-vault/:key/deposit", authHandler.authorizeRequest(), YieldVaultController.deposit);
router.post("/yield-vault/:key/redeem", authHandler.authorizeRequest(), YieldVaultController.redeem);
router.post("/yield-vault/:key/redeem-all", authHandler.authorizeRequest(), YieldVaultController.redeemAll);
router.post("/yield-vault/:key/claim", authHandler.authorizeRequest(), YieldVaultController.claim);
router.post("/yield-vault/:key/admin/strategy-approval", authHandler.authorizeRequest(), YieldVaultController.setStrategyApproval);
router.post("/yield-vault/:key/admin/min-idle-bps", authHandler.authorizeRequest(), YieldVaultController.setMinIdleBps);
router.post("/yield-vault/:key/admin/deploy", authHandler.authorizeRequest(), YieldVaultController.deployCapital);
router.post("/yield-vault/:key/admin/process-queue", authHandler.authorizeRequest(), YieldVaultController.processQueue);
router.post("/yield-vault/:key/admin/return", authHandler.authorizeRequest(), YieldVaultController.returnCapital);
router.post("/yield-vault/:key/admin/report-loss", authHandler.authorizeRequest(), YieldVaultController.reportLoss);

export default router;
