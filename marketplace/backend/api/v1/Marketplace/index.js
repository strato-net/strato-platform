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

router.post(
  Marketplace.transferUsdst,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.transferUsdst
);

router.get(
  Marketplace.getUsdstBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getUsdstsBalance
);

router.get(
  Marketplace.getCataBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getCataBalance
);

router.get(
  Marketplace.getUsdstAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getUsdstAddress
);

router.get(
  Marketplace.getCataAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  MarketplaceController.getCataAddress
);

router.get(
  Marketplace.getUsdstTransactionHistory,
  authHandler.authorizeRequest(),
  loadDapp,
  MarketplaceController.getUsdstTransactionHistory
);

export default router;
