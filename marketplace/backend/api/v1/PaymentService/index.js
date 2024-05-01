import express from "express";
import PaymentServiceController from "./paymentService.controller";
import { PaymentService } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
    PaymentService.stripeOnboarding,
    authHandler.authorizeRequest(),
    loadDapp,
    PaymentServiceController.stripeOnboarding
);

router.get(
    PaymentService.stripeConnectStatus,
    authHandler.authorizeRequest(true),
    loadDapp,
    PaymentServiceController.stripeOnboardingStatus
);

router.post(
    PaymentService.stripeWebhook,
    authHandler.getDeployersTokenForWebhook(),
    loadDapp,
    PaymentServiceController.stripeWebhook
);

router.post(
    PaymentService.stripeWebhookConnect,
    authHandler.getDeployersTokenForWebhook(),
    loadDapp,
    PaymentServiceController.stripeWebhookConnect
);

export default router;