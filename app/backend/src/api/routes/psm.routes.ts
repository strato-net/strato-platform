import { Router } from "express";
import authHandler from "../middleware/authHandler";
import PsmController from "../controllers/psm.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

router.get("/info", authHandler.authorizeRequest(), PsmController.getInfo);
router.post("/mint", walletAuth, PsmController.mint);
router.post("/redeem", walletAuth, PsmController.redeem);

export default router;
