import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import { config } from "./config";
import { logError, logInfo } from "./utils/logger";
import { bootstrapDb } from "./db/bootstrap";
import { initOpenIdConfig } from "./auth";
import { requireAuthorized } from "./auth/adminMiddleware";
import * as resolver from "./controllers/resolver.controller";
import * as events from "./controllers/events.controller";
import * as admin from "./controllers/admin.controller";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(bodyParser.json({ limit: "16kb" }));

const asyncHandler =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req, res).catch(next);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: true, message: "pong" });
});

// Public resolver + anonymous cookie-keyed beacons (no auth by design; the
// edge nginx routes these without openid/csrf lua)
app.get("/t/:slug", asyncHandler(resolver.resolve));
app.post("/tracking-api/engage", asyncHandler(events.engage));
app.post("/tracking-api/wallet-connected", asyncHandler(events.walletConnected));

// Dashboard API (edge enforces OIDC session; service enforces the
// sales/marketing allowlist or on-chain admin)
app.get("/tracking-api/me", asyncHandler(admin.me));
app.get("/tracking-api/links", requireAuthorized, asyncHandler(admin.list));
app.post("/tracking-api/links", requireAuthorized, asyncHandler(admin.create));
app.get("/tracking-api/links/:id", requireAuthorized, asyncHandler(admin.detail));
app.patch("/tracking-api/links/:id", requireAuthorized, asyncHandler(admin.update));

app.use(
  (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError("TrackingService", error, { operation: "request" });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

app.listen(config.port, async () => {
  try {
    logInfo("TrackingService", `Listening on port ${config.port}`);
    await bootstrapDb();
    // OIDC init failure disables the dashboard but must not take down the
    // resolver/beacons — retry in the background.
    const initAuth = async () => {
      try {
        await initOpenIdConfig();
      } catch (error) {
        logError("TrackingService", error, { operation: "initOpenIdConfig", retryInMs: 30000 });
        setTimeout(initAuth, 30000);
      }
    };
    if (config.auth.openIdDiscoveryUrl) void initAuth();
    logInfo("TrackingService", "Startup complete");
  } catch (error) {
    logError("TrackingService", error, { operation: "startup" });
    process.exit(1);
  }
});
