const express = require('express');
const RedemptionsController = require('./redemptions.controller');

const router = express.Router();

router.get(
  '/:commonName', 
  RedemptionsController.getRedemptions
);

router.post(
  '/create', 
  RedemptionsController.createRedemption
);

router.get(
  '/id/:id',
  RedemptionsController.getRedemption
);

router.delete(
  '/id/:id', 
  RedemptionsController.deleteRedemptions
);

module.exports = router;