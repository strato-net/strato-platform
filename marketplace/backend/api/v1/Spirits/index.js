import express from 'express';
import { Spirits } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';
import SpiritsController from './spirits.controller';

const router = express.Router();

router.get(
  Spirits.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  SpiritsController.getAll
);

router.post(
  Spirits.create,
  authHandler.authorizeRequest(),
  loadDapp,
  SpiritsController.create
);

export default router;
