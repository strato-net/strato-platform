import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { initOpenIdConfig, initNetworkConfig } from "./config/config";
import { errorHandler, notFoundHandler } from "./api/middleware/errorHandler";
import { requestLogger, getRequestStats, resetRequestStats } from "./api/middleware/requestLogger";
import authHandler from "./api/middleware/authHandler";

const PORT = process.env.PORT || 3001;
const METRICS_ADMINS = new Set(
  (process.env.METRICS_ADMINS || "").split(",").map(s => s.trim()).filter(Boolean)
);

const metricsGuard: express.RequestHandler = (req, res, next) => {
  if (!METRICS_ADMINS.has(req.userName as string)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};

const app = express();

app.use(
  cors(),
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
  express.urlencoded({ extended: true }),
  requestLogger
);

app.get("/api/metrics", authHandler.authorizeRequest(), metricsGuard, (req, res) => {
  const sortBy = (req.query.sortBy as string) || "avg";
  res.json(getRequestStats(sortBy as "avg" | "max" | "count"));
});
app.delete("/api/metrics", authHandler.authorizeRequest(), metricsGuard, (_req, res) => { resetRequestStats(); res.json({ reset: true }); });

app.use("/api", routes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler middleware (must be last)
app.use(errorHandler);

(async () => {
  try {
    await initOpenIdConfig();
    await initNetworkConfig();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
})();

export default app;
