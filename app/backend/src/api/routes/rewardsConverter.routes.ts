import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsConverterController from "../controllers/rewardsConverter.controller";

const router = Router();
const signedIn = authHandler.authorizeRequest(false);
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

router.get("/state", authHandler.authorizeRequest(true), RewardsConverterController.getState);

router.use(RewardsConverterController.requireConfigured);

router.get("/account", signedIn, RewardsConverterController.getAccount);
router.get("/history", signedIn, RewardsConverterController.getHistory);
router.post("/convert", walletAuth, RewardsConverterController.convert);

router.get("/admin/stats", signedIn, RewardsConverterController.getAdminStats);
router.get("/admin/volume/daily", signedIn, RewardsConverterController.getDailyVolume);
router.get("/admin/volume/monthly", signedIn, RewardsConverterController.getMonthlyVolume);
router.get("/admin/issue-execution", signedIn, RewardsConverterController.getIssueExecution);
router.post("/admin/set-rate", walletAuth, RewardsConverterController.setRate);
router.post("/admin/pause", walletAuth, RewardsConverterController.pause);
router.post("/admin/unpause", walletAuth, RewardsConverterController.unpause);
router.post("/admin/withdraw-reserve", walletAuth, RewardsConverterController.withdrawReserve);
router.post("/admin/fund-reserve", walletAuth, RewardsConverterController.fundReserve);

export default router;
