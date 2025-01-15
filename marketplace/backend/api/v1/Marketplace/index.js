import express from 'express';
import MarketplaceController from './marketplace.controller';
import { Marketplace } from '../endpoints';
import loadDapp from '../../middleware/loadDappHandler';
import authHandler from '../../middleware/authHandler';

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
  Marketplace.getStakeableProducts,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getStakeableProducts
);

router.get(
  Marketplace.getUSDSTBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getUSDSTBalance
);

router.get(
  Marketplace.getCataBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getCataBalance
);

router.get(
  Marketplace.getUSDSTBalance,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getUSDSTBalance
);

router.get(
  Marketplace.getUSDSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getUSDSTAddress
);

router.get(
  Marketplace.getCataAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getCataAddress
);

router.get(
  Marketplace.getStratsAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getStratsAddress
);

router.get(
  Marketplace.get18DecimalPlaces,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.get18DecimalPlaces
);

export default router;
