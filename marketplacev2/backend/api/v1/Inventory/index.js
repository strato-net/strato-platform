import express from "express";
import InventoryController from "./inventory.controller";
import { Inventory } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Inventory.search,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.search
);

router.get(
  Inventory.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.get
);

router.get(
  Inventory.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAll
);

router.post(
  Inventory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.create
);

router.post(
  Inventory.resell,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.resell
);

router.put(
  Inventory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.update
)

export default router;
