import express from "express";
import MarketplaceController from "./marketplace.controller";
import { Marketplace } from "../endpoints";
import loadDapp from "../../middleware/loadDappHandler";
import authHandler from "../../middleware/authHandler";

const router = express.Router();

router.get(
  Marketplace.getAll,
  loadDapp,
  MarketplaceController.getAll
);

router.get(
  Marketplace.getTopSellingProducts,
  loadDapp,
  MarketplaceController.getTopSellingProducts
);

export default router;
