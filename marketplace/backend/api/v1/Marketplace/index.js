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
  Marketplace.getAllLoggedIn,
  loadDapp,
  MarketplaceController.getAllLoggedIn
);

router.get(
  Marketplace.getTopSellingProducts,
  loadDapp,
  MarketplaceController.getTopSellingProducts
);

router.get(
  Marketplace.getTopSellingProductsLoggedIn,
  loadDapp,
  MarketplaceController.getTopSellingProductsLoggedIn
);

export default router;
