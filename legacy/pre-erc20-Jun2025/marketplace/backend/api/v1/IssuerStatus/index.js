import express from 'express';
import { IssuerStatus } from '../endpoints';
import IssuerStatusController from './issuerStatus.controller';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.post(
  IssuerStatus.requestReview,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.requestReview
);

router.post(
  IssuerStatus.authorizeIssuer,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.authorizeIssuer
);

router.post(
  IssuerStatus.deauthorizeIssuer,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.deauthorizeIssuer
);

router.post(
  IssuerStatus.admin,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.setIsAdmin
);

export default router;
