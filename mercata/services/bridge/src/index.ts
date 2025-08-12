import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import logger from "./utils/logger";
import { startMultiChainDepositPolling } from "./polling/alchemyPolling";
import { initializeMercataPolling } from "./polling/mercataPolling";
import { initializeOAuth, validateChainRpcUrls } from "./config";
import { initOpenIdConfig } from "./auth";

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(cors());
app.use(bodyParser.json());

app.get("/health", (_, res) => res.status(200).json({ status: "ok" }));

app.listen(port, async () => {
  await initializeOAuth();
  await validateChainRpcUrls();
  await initOpenIdConfig();
  await startMultiChainDepositPolling();
  await initializeMercataPolling();
  logger.info(`Bridge service listening on port ${port}`);
});