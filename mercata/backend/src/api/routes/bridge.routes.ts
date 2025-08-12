import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeController from "../controllers/bridge.controller";

const router = Router();

// ----- Bridge Operations -----
router.post("/bridgeOut", authHandler.authorizeRequest(), BridgeController.bridgeOut);

// ----- Bridge Configuration -----
router.get("/bridgeableTokens", authHandler.authorizeRequest(false), BridgeController.getBridgeableTokens);
router.get("/ethereumConfig", authHandler.authorizeRequest(false), BridgeController.getEthereumConfig);

// ----- Bridge Status -----
router.get("/status/:status", authHandler.authorizeRequest(), BridgeController.getBridgeStatus);

export default router;
