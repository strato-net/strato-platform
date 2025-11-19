import { Request, Router, Response, NextFunction } from "express";
import express from "express";
import swaggerUi from "swagger-ui-express";

import packageJson from "../../package.json";
import { swaggerSpec } from "../config/swagger.config";

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
import rewardsRoutes from "./routes/rewards.routes";
import protocolFeeRoutes from "./routes/protocolFee.routes";

const router = Router();

// TODO: add /constants route to expose backend constants to the UI

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

// ----- Rewards Routes -----
router.use("/rewards", rewardsRoutes);

// ----- Protocol Fee Routes -----
router.use("/protocol-fees", protocolFeeRoutes);

// ----- Documentation Routes -----
// Serve static files for Swagger customizations
router.use("/public", express.static("src/public"));

// Swagger API Documentation with no-cache headers to prevent stale docs
router.use("/docs", (req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "Mercata API Documentation",
  customJs: '/api/public/swagger-csrf.js',
}));

// Serve OpenAPI spec as JSON with no-cache headers
router.get("/public/api-docs.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(swaggerSpec);
});

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
