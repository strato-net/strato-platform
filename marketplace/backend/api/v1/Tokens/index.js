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

router.post(
  Tokens.addHash,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.addHash
)

export default router;
