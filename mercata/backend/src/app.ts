import express from "express";
import cors from "cors";
import routes from "./api/routes";
import { initOpenIdConfig } from "./config/config";

const PORT = process.env.PORT || 3001;

const app = express();

app.use(cors(), express.json(), express.urlencoded({ extended: true }));

app.use("/api", routes);

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
