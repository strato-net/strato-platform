import express from 'express';
import TokensController from './tokens.controller';
import { Tokens } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Tokens.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getAll
);

router.post(
  Tokens.create,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.create
);

export default router;
