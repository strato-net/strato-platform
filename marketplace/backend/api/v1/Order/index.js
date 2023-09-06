import express from "express";
import OrderController from "./order.controller";
import { Order } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import { sendEmail } from '../services/sendGridService';

const router = express.Router();

router.get(
  Order.get,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.get
);

router.get(
  Order.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAll
);

router.post(
  Order.create,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.create
);

router.put(
  Order.updateBuyerDetails,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateBuyerDetails
)

router.put(
  Order.updateSellerDetails,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateSellerDetails
)

router.post(
  Order.payment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.payment
)

router.get(
  Order.paymentSession,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.paymentSession
)

router.post(
  Order.userAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.createUserAddress
)

router.get(
  Order.getAllUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAllUserAddress
)

router.post('/send-email', async (req, res) => {
  const { to, subject, htmlContent } = req.body;
  try {
    await sendEmail(to, subject, htmlContent);
    res.status(200).send({ message: 'Email sent successfully!' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to send email.' });
  }
});

export default router;
