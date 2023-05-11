import express from "express";
import InventoryController from "./inventory.controller";
import { Inventory } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
// import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  Inventory.get,
  authHandler.authorizeRequest(),
  loadDapp,
  // attachMembership,
  InventoryController.get
);

router.get(
  Inventory.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  // attachMembership,
  InventoryController.getAll
);

router.post(
  Inventory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  // attachMembership,
  InventoryController.create
);

// router.post(
//   Inventory.transferOwnership,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   InventoryController.transferOwnership
// )

router.put(
  Inventory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  // attachMembership,
  InventoryController.update
)

// router.get(
//   Inventory.audit,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   InventoryController.audit
// )

export default router;
