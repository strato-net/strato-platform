import express from "express";
import OrderLineItemController from "./orderLineItem.controller";
import { OrderLineItem } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  OrderLineItem.get,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.get
);

router.get(
  OrderLineItem.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.getAll
);

router.post(
  OrderLineItem.create,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.create
);

router.post(
  OrderLineItem.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.transferOwnership
)

router.put(
  OrderLineItem.update,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.update
)

router.get(
  OrderLineItem.audit,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineItemController.audit
)

export default router;
