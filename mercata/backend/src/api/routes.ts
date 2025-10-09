import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";

import TokensController from "./controllers/tokens.controller";
import OracleController from "./controllers/oracle.controller";
import ConfigController from "./controllers/config.controller";
import userRoutes from "./routes/user.routes";
import swapRoutes from "./routes/swap.routes";
import lendingRoutes from "./routes/lending.routes";
import eventsRoutes from "./routes/events.routes";
import bridgeRoutes from "./routes/bridge.routes";
import cdpRoutes from "./routes/cdp.routes";
import rewardsRoutes from "./routes/rewards.routes";

const router = Router();

// ----- User Routes -----
router.use("/user", userRoutes);

// ----- Token Routes -----
router.get("/tokens/balance", authHandler.authorizeRequest(), TokensController.getBalance);
router.get("/vouchers/balance", authHandler.authorizeRequest(), TokensController.getVoucherBalance);
router.get("/config", ConfigController.getConfig);
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

// ----- Bridge Routes -----
router.use("/bridge", bridgeRoutes);

// ----- CDP Routes -----
router.use("/cdp", cdpRoutes);

// ----- Rewards Routes -----
router.use("/rewards", rewardsRoutes);

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
