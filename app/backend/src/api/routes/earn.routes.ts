import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EarnController from "../controllers/earn.controller";
import SaveUsdstController from "../controllers/saveUsdst.controller";
import YieldVaultController from "../controllers/yieldVault.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

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
router.get("/save-usdst/history", authHandler.authorizeRequest(true), SaveUsdstController.getHistory);
router.get("/save-usdst/user", authHandler.authorizeRequest(), SaveUsdstController.getUserInfo);
router.post("/save-usdst/deposit", walletAuth, SaveUsdstController.deposit);
router.post("/save-usdst/redeem", walletAuth, SaveUsdstController.redeem);
router.post("/save-usdst/redeem-all", walletAuth, SaveUsdstController.redeemAll);

router.get("/yield-vault", authHandler.authorizeRequest(true), YieldVaultController.list);
router.get("/yield-vault/:key/info", authHandler.authorizeRequest(true), YieldVaultController.getInfo);
router.get("/yield-vault/:key/user", authHandler.authorizeRequest(), YieldVaultController.getUserInfo);
router.post("/yield-vault/:key/deposit", walletAuth, YieldVaultController.deposit);
router.post("/yield-vault/:key/redeem", walletAuth, YieldVaultController.redeem);
router.post("/yield-vault/:key/redeem-all", walletAuth, YieldVaultController.redeemAll);
router.post("/yield-vault/:key/claim", walletAuth, YieldVaultController.claim);
router.post("/yield-vault/:key/admin/strategy-approval", walletAuth, YieldVaultController.setStrategyApproval);
router.post("/yield-vault/:key/admin/min-idle-bps", walletAuth, YieldVaultController.setMinIdleBps);
router.post("/yield-vault/:key/admin/deploy", walletAuth, YieldVaultController.deployCapital);
router.post("/yield-vault/:key/admin/process-queue", walletAuth, YieldVaultController.processQueue);
router.post("/yield-vault/:key/admin/return", walletAuth, YieldVaultController.returnCapital);
router.post("/yield-vault/:key/admin/report-loss", walletAuth, YieldVaultController.reportLoss);

export default router;
