import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { initOpenIdConfig } from "./config/config";
import { errorHandler, notFoundHandler } from "./api/middleware/errorHandler";
import { constants } from "./config/constants";

const PORT = process.env.PORT || 3001;

const app = express();

app.use(cors(), express.json(), express.urlencoded({ extended: true }));

app.use("/api", routes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler middleware (must be last)
app.use(errorHandler);

(async () => {
  try {
    await initOpenIdConfig();
    console.log('ENV POOL_FACTORY =', process.env.POOL_FACTORY);
    console.log('PoolFactory constant at runtime:', constants.poolFactory);
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
})();

export default app;
