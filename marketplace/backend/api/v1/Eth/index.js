import express from 'express';
import EthController from './eth.controller';
import { Eth } from '../endpoints';
import loadDapp from '../../middleware/loadDappHandler';
import authHandler from '../../middleware/authHandler';

const router = express.Router();

// router.get(
//   Marketplace.getETHSTBalance,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   MarketplaceController.getETHSTBalance
// );

router.get(
  Eth.getETHSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  EthController.getETHSTAddress
);

router.get(
  Eth.getWBTCSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  EthController.getWBTCSTAddress
);

router.post(
  Eth.addHash,
  authHandler.authorizeRequest(),
  loadDapp,
  EthController.addHash
)


export default router;
