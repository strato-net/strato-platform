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

router.get(
  Tokens.getBridgeableTokens,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.getBridgeableTokens
);

export default router;
