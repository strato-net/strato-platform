const express = require('express');
const StripeServiceController = require('./stripeService.controller');

const router = express.Router();

router.get(
  '/onboard/:accountId?', 
  StripeServiceController.stripeOnboarding
);

router.get(
  '/status/:accountId', 
  StripeServiceController.stripeConnectStatus
);

router.post(
  '/checkout',
  StripeServiceController.stripeCheckout
)

router.get(
  '/session/:sessionId/:sellerId',
  StripeServiceController.stripeGetSession
)

router.get(
  '/intent/:sessionId/:sellerId',
  StripeServiceController.stripeGetIntent
)

router.post(
  '/webhook',
  StripeServiceController.stripeWebhook
);

router.post(
  '/webhook/connect', 
  StripeServiceController.stripeWebhookConnect
);

module.exports = router;