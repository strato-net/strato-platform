import express from "express";
import MarketplaceController from "./marketplace.controller";
import { Marketplace } from "../endpoints";
import loadDapp from "../../middleware/loadDappHandler";

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
