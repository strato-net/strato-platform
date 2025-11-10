import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeAdminController from "../controllers/bridgeAdmin.controller";

const router = Router();

// All routes require admin access (checked via isAdmin middleware or manual check)
router.get("/withdrawals", authHandler.authorizeRequest(), BridgeAdminController.getWithdrawals);
router.get("/deposits", authHandler.authorizeRequest(), BridgeAdminController.getDeposits);

export default router;

