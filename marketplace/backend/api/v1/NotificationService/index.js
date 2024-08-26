import express from "express";
import NotificationController from "./notification.controller";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.post(
  "/new-registration",
  authHandler.authorizeRequest(),
  loadDapp,
  NotificationController.sendNewRegistrationEmail
);

router.post(
  "/first-purchase",
  authHandler.authorizeRequest(),
  loadDapp,
  NotificationController.sendFirstPurchaseEmail
);

router.post(
  "/additional-purchase",
  authHandler.authorizeRequest(),
  loadDapp,
  NotificationController.sendAdditionalPurchaseEmail
);

router.post(
  "/seller-reward",
  authHandler.authorizeRequest(),
  loadDapp,
  NotificationController.sendSellerRewardEmail
);

export default router;
