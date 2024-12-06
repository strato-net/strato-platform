import express from 'express';
import EscrowController from './escrow.controller';
import { Escrow } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Escrow.getCataRewards,
  authHandler.authorizeRequest(true),
  loadDapp,
  EscrowController.getCataRewards
);

router.get(
  Escrow.getEscrowForAsset,
  authHandler.authorizeRequest(true),
  loadDapp,
  EscrowController.getEscrowForAsset
);

export default router;
