import express from 'express';
import MetalsController from './metals.controller';
import { Metals } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Metals.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MetalsController.getAll
);

router.post(
  Metals.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MetalsController.create
);

export default router;
