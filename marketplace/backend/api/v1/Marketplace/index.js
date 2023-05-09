import express from "express";
import MarketplaceController from "./marketplace.controller";
import { Marketplace } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Marketplace.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getAll
);

router.get(
  Marketplace.getTopSellingProducts,
  // authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getTopSellingProducts
);

export default router;
