import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";

import TokensController from "./controllers/tokens.controller";
import OnRampController from "./controllers/onramp.controller";
import { BridgeController } from "./controllers/bridge.controller";
import OracleController from "./controllers/oracle.controller";
import userRoutes from "./routes/user.routes";
import swapRoutes from "./routes/swap.routes";
import lendingRoutes from "./routes/lending.routes";
import eventsRoutes from "./routes/events.routes";

const router = Router();
const bridgeController = new BridgeController();

// ----- User Routes -----
router.use("/user", userRoutes);

// ----- Token Routes -----
router.get("/tokens/balance", authHandler.authorizeRequest(), TokensController.getBalance);
router.get("/tokens/:address", authHandler.authorizeRequest(true), TokensController.get);
router.get("/tokens/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/tokens/", authHandler.authorizeRequest(), TokensController.create);
router.post("/tokens/transfer", authHandler.authorizeRequest(), TokensController.transfer);
router.post("/tokens/approve", authHandler.authorizeRequest(), TokensController.approve);
router.post("/tokens/transferFrom", authHandler.authorizeRequest(), TokensController.transferFrom);
router.post("/tokens/setStatus", authHandler.authorizeRequest(), TokensController.setStatus);

// ----- Swap Routes -----
router.use(swapRoutes);

// ----- Lending Routes -----
router.use("/lending", lendingRoutes);
// UI compatibility alias
router.use("/lend", lendingRoutes);

// ----- Events Routes -----
router.use("/events", eventsRoutes);

// ----- Oracle Routes -----
router.get("/oracle/price", authHandler.authorizeRequest(true), OracleController.getPrice);
router.get("/oracle/price-history/:assetAddress", authHandler.authorizeRequest(true), OracleController.getPriceHistory);
router.post("/oracle/price", authHandler.authorizeRequest(), OracleController.setPrice);

// ----- Onramp Routes -----
router.get("/onramp/", authHandler.authorizeRequest(true), OnRampController.get);
router.post("/onramp/buy", authHandler.authorizeRequest(), OnRampController.buy);
router.post("/onramp/sell", authHandler.authorizeRequest(), OnRampController.sell);

// ----- Bridge Routes -----
router.post("/bridge/bridgeIn", authHandler.authorizeRequest(), bridgeController.bridgeIn);
router.post("/bridge/bridgeOut", authHandler.authorizeRequest(), bridgeController.bridgeOut);
router.get("/bridge/balance/:tokenAddress", authHandler.authorizeRequest(), bridgeController.getBalance);
router.get("/bridge/bridgeInTokens", authHandler.authorizeRequest(), bridgeController.getBridgeInTokens);
router.get("/bridge/bridgeOutTokens", authHandler.authorizeRequest(), bridgeController.getBridgeOutTokens);
router.get("/bridge/config", bridgeController.getBridgeConfig);
router.get("/bridge/depositStatus/:status", authHandler.authorizeRequest(), bridgeController.userDepositStatus);
router.get("/bridge/withdrawalStatus/:status", authHandler.authorizeRequest(), bridgeController.userWithdrawalStatus);

// ----- Health Check -----
router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next();
});

export default router;
