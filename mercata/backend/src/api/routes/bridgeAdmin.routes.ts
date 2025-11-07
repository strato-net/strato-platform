import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeAdminController from "../controllers/bridgeAdmin.controller";

const router = Router();

// All routes require admin access (checked via isAdmin middleware or manual check)
router.get("/withdrawals", authHandler.authorizeRequest(), BridgeAdminController.getWithdrawals);
router.get("/withdrawals/:id", authHandler.authorizeRequest(), BridgeAdminController.getWithdrawal);
router.post("/withdrawals/:id/abort", authHandler.authorizeRequest(), BridgeAdminController.abortWithdrawal);

router.get("/deposits", authHandler.authorizeRequest(), BridgeAdminController.getDeposits);
router.post("/deposits/abort", authHandler.authorizeRequest(), BridgeAdminController.abortDeposit);

export default router;

