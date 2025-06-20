import express from 'express';
import OrderController from './order.controller';
import { Order } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Order.export,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.export
);

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
  Order.payment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.payment
);

router.post(
  Order.userAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.createUserAddress
);

router.get(
  Order.getUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getUserAddress
);

router.get(
  Order.getAllUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAllUserAddress
);

router.get(
  Order.waitForOrderEvent,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.waitForOrderEvent
);

router.post(
  Order.cancelSaleOrder,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.cancelSaleOrder
);

router.post(
  Order.executeSale,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.executeSale
);

router.put(
  Order.updateOrderComment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateOrderComment
);

router.post(
  Order.checkSaleQuantity,
  authHandler.authorizeRequest(true),
  loadDapp,
  OrderController.checkSaleQuantity
);

export default router;
