import express from "express";
import OrderController from "./order.controller";
import { Order } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Order.export,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.export
)

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
  Order.updateOrderStatus,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateOrderStatus
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

router.get(
  Order.paymentIntent,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.paymentIntent
)

router.post(
  Order.userAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.createUserAddress
)

router.get(
  Order.getAddressFromId,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAddressFromId
)

router.get(
  Order.getAllUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAllUserAddress
)

router.post(
  Order.createSaleOrder,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.createSaleOrder,
)

router.post(
  Order.cancelSaleOrder,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.cancelSaleOrder,
)

router.post(
  Order.executeSale,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.executeSale
)

router.put(
  Order.updateOrderComment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateOrderComment
)


export default router;
