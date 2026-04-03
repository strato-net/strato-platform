import { Router } from "express";
import authHandler from "../middleware/authHandler";
import PsmController from "../controllers/psm.controller";

const router = Router();

router.get("/info", authHandler.authorizeRequest(), PsmController.getInfo);
router.post("/mint", authHandler.authorizeRequest(), PsmController.mint);
router.post("/request-burn", authHandler.authorizeRequest(), PsmController.requestBurn);
router.post("/complete-burn", authHandler.authorizeRequest(), PsmController.completeBurn);
router.post("/cancel-burn", authHandler.authorizeRequest(), PsmController.cancelBurn);

export default router;
