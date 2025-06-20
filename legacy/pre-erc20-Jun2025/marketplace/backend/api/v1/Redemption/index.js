import express from 'express';
import RedemptionController from './redemption.controller';
import { Redemption } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Redemption.getRedemptionServices,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getRedemptionServices
);

router.get(
  Redemption.getOutgoingRedemptionRequests,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getOutgoingRedemptionRequests
);

router.get(
  Redemption.getIncomingRedemptionRequests,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getIncomingRedemptionRequests
);

router.get(
  Redemption.get,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.get
);

router.post(
  Redemption.create,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.requestRedemption
);

router.put(
  Redemption.close,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.closeRedemption
);

export default router;
