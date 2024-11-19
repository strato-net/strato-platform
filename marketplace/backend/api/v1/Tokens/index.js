import express from 'express';
import TokensController from './tokens.controller';
import { Tokens } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Tokens.getAll, // Assuming this is the correct endpoint for getting all tokens
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getAll
);

router.post(
  Tokens.create, // Assuming this is the correct endpoint for creating an token
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.create
);

export default router;
