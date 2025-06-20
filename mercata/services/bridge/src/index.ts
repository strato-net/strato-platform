import logger from "./utils/logger";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bridgeRoutes from "./routes/bridgeRoutes";
import bodyParser from "body-parser";
// import { initializeSockets } from "./sockets/initializeSockets";
import { initOpenIdConfig } from "./auth";
import { initializeAlchemyPolling } from "./polling/initializePolling";

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(cors());
app.use(bodyParser.json());

app.use("/api/bridge", bridgeRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});
// // Initialize WebSocket connections
// initializeSockets().catch((error) => {
//   logger.error("Failed to initialize WebSocket connections:", error);
// });

// Start the server


app.listen(port, async () => {
  await initOpenIdConfig();
  await initializeAlchemyPolling();
  logger.info(`Bridge service listening on port ${port}`);
});
