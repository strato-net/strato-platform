import express from 'express';
import StripeServiceController from './stripeService.controller.js';

const router = express.Router();

router.get(
  '/onboard', 
  StripeServiceController.stripeOnboarding
);

router.get(
  '/status', 
  StripeServiceController.stripeConnectStatus
);

router.get(
  '/checkout',
  StripeServiceController.stripeCheckout
);

router.get(
  '/checkout/confirm',
  StripeServiceController.stripeCheckoutConfirm
);

export default router;