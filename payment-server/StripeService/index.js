import express from 'express';
import StripeServiceController from './stripeService.controller.js';

const router = express.Router();

router.get(
  '/onboard/:commonName', 
  StripeServiceController.stripeOnboarding
);

router.get(
  '/status/:commonName', 
  StripeServiceController.stripeConnectStatus
);

router.get(
  '/checkout/:address/:token',
  StripeServiceController.stripeCheckout
);

router.post(
  '/checkout/confirm',
  StripeServiceController.stripeCheckoutConfirm
);

export default router;