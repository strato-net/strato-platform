import express from 'express';
import TokensController from './tokens.controller';
import { Tokens } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.post(
  Tokens.create,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.create
);

router.get(
  Tokens.getETHSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getETHSTAddress
);

router.get(
  Tokens.getWBTCSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getWBTCSTAddress
);

router.get(
  Tokens.getUSDTSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getUSDTSTAddress
);

router.get(
  Tokens.getUSDCSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getUSDCSTAddress
);

router.get(
  Tokens.getPAXGSTAddress,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getPAXGSTAddress
);

router.post(
  Tokens.addHash,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.addHash
)

router.post(
  Tokens.bridgeOut,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.bridgeOut
);

export default router;
