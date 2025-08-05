import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { Request, Response } from "express";
import { stripe } from "./utils/stripeClient";
import { stripeWebhookKey } from "./config/config";
import { initOpenIdConfig } from "./config/config";

const PORT = process.env.PORT || 3002;

const app = express();

app.use(cors(), express.json(), express.urlencoded({ extended: true }));

app.use("/", routes);

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
