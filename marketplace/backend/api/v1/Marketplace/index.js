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

router.post(
  Marketplace.transferStrats,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.transferStrats
);

router.get(
  Marketplace.getStratsBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getStratsBalance
);

router.get(
  Marketplace.getCataBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getCataBalance
);

router.get(
  Marketplace.getStratsAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getStratsAddress
);

router.get(
  Marketplace.getCataAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getCataAddress
);

router.get(
  Marketplace.getStratsTransactionHistory,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getStratsTransactionHistory
);

export default router;
