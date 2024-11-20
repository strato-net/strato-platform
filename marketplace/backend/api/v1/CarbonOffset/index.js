import express from 'express';
import CarbonOffsetController from './carbonOffset.controller';
import { CarbonOffset } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  CarbonOffset.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CarbonOffsetController.getAll
);

router.post(
  CarbonOffset.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonOffsetController.create
);

export default router;
