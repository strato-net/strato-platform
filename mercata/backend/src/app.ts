import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { initOpenIdConfig, initNetworkConfig, initProtocolContractAddresses } from "./config/config";
import { errorHandler, notFoundHandler } from "./api/middleware/errorHandler";

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
    await initNetworkConfig();
    await initProtocolContractAddresses();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
})();

export default app;
