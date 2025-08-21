import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeController from "../controllers/bridge.controller";

const router = Router();

// ----- Bridge Operations -----
router.post("/bridgeOut", authHandler.authorizeRequest(), BridgeController.bridgeOut);

// ----- Bridge Configuration -----
router.get("/bridgeableTokens/:chainId", authHandler.authorizeRequest(false), BridgeController.getBridgeableTokens);
router.get("/networkConfigs", authHandler.authorizeRequest(false), BridgeController.getNetworkConfigs);
router.get("/tokenLimit/:tokenAddress", authHandler.authorizeRequest(false), BridgeController.getTokenLimit);

// ----- Bridge Status -----
router.get("/status/:status", authHandler.authorizeRequest(), BridgeController.getBridgeStatus);

export default router;
