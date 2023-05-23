import express from "express";
import ItemController from "./item.controller";
import { Item } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();


router.get(
  Item.getAll,
  loadDapp,
  ItemController.getAll
);

router.get(
  Item.ownershipHistory,
  loadDapp,
  ItemController.getOwnershipHistory
);

router.post(
  Item.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.create
);

router.post(
  Item.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.transferOwnership
)

router.put(
  Item.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ItemController.update
)

router.get(
  Item.audit,
  loadDapp,
  ItemController.audit
)

router.get(
  Item.getRawMaterials,
  loadDapp,
  ItemController.getAllRawMaterials
)

export default router;
