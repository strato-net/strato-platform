import express from 'express';
import CollectiblesController from './collectibles.controller';
import { Collectibles } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Collectibles.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CollectiblesController.getAll
);

router.post(
  Collectibles.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CollectiblesController.create
);

export default router;
