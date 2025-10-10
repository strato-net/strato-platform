import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";
import TokensController from "./controllers/tokens.controller";
import userRoutes from "./routes/user.routes";
import tokensRoutes from "./routes/tokens.routes";
import configRoutes from "./routes/config.routes";
import oracleRoutes from "./routes/oracle.routes";
import swapRoutes from "./routes/swap.routes";
import lendingRoutes from "./routes/lending.routes";
import eventsRoutes from "./routes/events.routes";
import bridgeRoutes from "./routes/bridge.routes";
import cdpRoutes from "./routes/cdp.routes";

const router = Router();

// ----- User Routes -----
router.use("/user", userRoutes);

// ----- Token Routes -----
router.use("/tokens", tokensRoutes);

// ----- Vouchers Route (separate path) -----
/**
 * @openapi
 * /vouchers/balance:
 *   get:
 *     summary: Get voucher balance
 *     description: Retrieve the voucher balance for the authenticated user
 *     tags:
 *       - Tokens
 *     responses:
 *       200:
 *         description: Voucher balance retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/vouchers/balance", authHandler.authorizeRequest(), TokensController.getVoucherBalance);

// ----- Configuration Routes -----
router.use("/config", configRoutes);

// ----- Oracle Routes -----
router.use("/oracle", oracleRoutes);

// ----- Swap Routes -----
router.use(swapRoutes);

// ----- Lending Routes -----
router.use("/lending", lendingRoutes);
// UI compatibility alias
router.use("/lend", lendingRoutes);

// ----- Events Routes -----
router.use("/events", eventsRoutes);

// ----- Bridge Routes -----
router.use("/bridge", bridgeRoutes);

// ----- CDP Routes -----
router.use("/cdp", cdpRoutes);

// ----- Health Check -----
/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the service health status, name, version, and timestamp
 *     tags:
 *       - Health
 *     security: []
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next();
});

export default router;
