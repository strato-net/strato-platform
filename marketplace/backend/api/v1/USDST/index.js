import express from 'express';
import USDSTController from './USDST.controller';
import { USDST } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  USDST.getAll, // Assuming this is the correct endpoint for getting all USDST
  authHandler.authorizeRequest(true),
  loadDapp,
  USDSTController.getAll
);

router.post(
  USDST.create, // Assuming this is the correct endpoint for creating USDST
  authHandler.authorizeRequest(),
  loadDapp,
  USDSTController.create
);

export default router;
