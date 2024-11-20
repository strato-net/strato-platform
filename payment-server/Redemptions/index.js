import express from 'express';
import RedemptionsController from './redemptions.controller.js';

const router = express.Router();

router.get(
  '/outgoing/:commonName', 
  RedemptionsController.getOutgoingRedemptionRequests
);

router.get(
  '/incoming/:commonName', 
  RedemptionsController.getIncomingRedemptionRequests
);

router.get(
  '/all', 
  RedemptionsController.getAllRedemptionRequests
);

router.post(
  '/create', 
  RedemptionsController.createRedemption
);

router.get(
  '/:id',
  RedemptionsController.getRedemption
);

router.delete(
  '/id/:id', 
  RedemptionsController.deleteRedemptions
);

router.put(
  '/close/:id',
  RedemptionsController.closeRedemption
);

export default router;