import { Router } from "express";
import logger from "../utils/logger";
import { getUserToken } from "../auth";
import { handleBridgeOut } from "../events/bridgeOut";
import { config } from "../config";
import { ethers } from "ethers";
import { getAllBridgeTransactionsHandler } from "../controllers/bridgeTransactionsController";

export function createSafeRoutes(): Router {
  const router = Router();

  router.post("/strato-to-ethereum", async (req, res, next) => {
    try {
      const { hash, value, to, from } = req.body;
      logger.info("Request body:", req.body);
      logger.info("Extracted transaction details:", { hash, value, to, from });

      if (!value) {
        throw new Error("Value is required in the request body");
      }

      const accessToken = await getUserToken();
      if (!accessToken) {
        throw new Error("Failed to get access token");
      }

      // Call handleBridgeOut with the transaction details
      await handleBridgeOut({
        hash,
        value,
        to,
        from,
        token: config.bridge.tokenAddress ||'',
        accessToken  
      });

      res.status(200).json({ message: "Bridge out transaction processed successfully" });
    } catch (error: any) {
      logger.error("Error in strato-to-mercata route:", error?.message);
      res.status(500).json({ error: error?.message || "Internal server error" });
    }
  });
  
  // Route for getting all bridge transactions
  router.get("/transaction/:type", getAllBridgeTransactionsHandler);

  return router;
}
