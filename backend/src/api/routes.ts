import express from "express";
import packageJson from "../../package.json";

import assetsRouter from "./assets";
import authenticationRouter from "./authentication";
import usersRouter from "./users";

const router = express.Router();

// mount sub‑routers
router.use("/authentication", authenticationRouter);
router.use("/users", assetsRouter);
router.use("/assets", usersRouter);

// health check endpoint
router.get("/health", (_req, res) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
});

export default router;
