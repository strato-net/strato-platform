import express from 'express';
import StripeServiceController from './stripeService.controller.js';
import Stripe from 'stripe';

const router = express.Router();

router.get(
  '/onboard', 
  StripeServiceController.stripeOnboarding
);

router.get(
  '/onboard/confirm',
  StripeServiceController.stripeOnboardingConfirm
);

router.get(
  '/status', 
  StripeServiceController.stripeConnectStatus
);

router.get(
  '/checkout/:orderHash',
  StripeServiceController.stripeCheckout
);

router.get(
  '/checkout/confirm/:orderHash',
  StripeServiceController.stripeCheckoutConfirm
);

router.get(
  '/checkout/cancel/:orderHash',
  StripeServiceController.stripeCheckoutCancel
);

router.get(
  '/order/status',
  StripeServiceController.stripeOrderStatus
)

export default router;