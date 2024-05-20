import express from 'express';
import StripeServiceController from './stripeService.controller.js';
import Stripe from 'stripe';

const router = express.Router();

router.get(
  '/onboard', 
  StripeServiceController.stripeOnboarding
);

router.post(
  '/onboard/confirm',
  StripeServiceController.stripeOnboardingConfirm
);

router.get(
  '/status', 
  StripeServiceController.stripeConnectStatus
);

router.get(
  '/checkout',
  StripeServiceController.stripeCheckout
);

router.post(
  '/checkout/confirm',
  StripeServiceController.stripeCheckoutConfirm
);

router.put(
  '/checkout/cancel',
  StripeServiceController.stripeCheckoutCancel
);

router.get(
  '/order/status',
  StripeServiceController.stripeOrderStatus
)

export default router;