import express from "express";
import MarketplaceController from "./marketplace.controller";
import { Marketplace } from "../endpoints";
import loadDapp from "../../middleware/loadDappHandler";
import authHandler from "../../middleware/authHandler";

const router = express.Router();

router.get(
  Marketplace.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getAll
);

router.get(
  Marketplace.getAllLoggedIn,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getAllLoggedIn
);

router.get(
  Marketplace.getTopSellingProducts,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getTopSellingProducts
);

router.get(
  Marketplace.getTopSellingProductsLoggedIn,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getTopSellingProductsLoggedIn
);

router.get(
  Marketplace.getStratsBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getStratsBalance
);


export default router;
