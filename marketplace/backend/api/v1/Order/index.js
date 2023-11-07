import express from "express";
import OrderController from "./order.controller";
import { Order } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

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

router.post(
  Order.executeSale,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.executeSale
)


export default router;
