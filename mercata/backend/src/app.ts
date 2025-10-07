import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import routes from "./api/routes";
import { initOpenIdConfig } from "./config/config";
import { errorHandler, notFoundHandler } from "./api/middleware/errorHandler";
import { swaggerSpec } from "./config/swagger.config";

const PORT = process.env.PORT || 3001;

const app = express();

app.use(cors(), express.json(), express.urlencoded({ extended: true }));

// Swagger API Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "Mercata API Documentation",
}));

// Serve OpenAPI spec as JSON
app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use("/api", routes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler middleware (must be last)
app.use(errorHandler);

(async () => {
  try {
    await initOpenIdConfig();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
})();

export default app;
