import express from "express";
import InventoryController from "./inventory.controller";
import { Inventory } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Inventory.get,
  // authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.get
);

router.get(
  Inventory.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAll
);

router.post(
  Inventory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.create
);

router.put(
  Inventory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.update
)

export default router;
