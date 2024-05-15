const express = require('express');
const RedemptionsController = require('./redemptions.controller');

const router = express.Router();

router.get(
  '/outgoing/:commonName', 
  RedemptionsController.getOutgoingRedemptionRequests
);

router.get(
  '/incoming/:commonName', 
  RedemptionsController.getIncomingRedemptionRequests
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

module.exports = router;