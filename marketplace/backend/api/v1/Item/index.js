import express from "express";
import ItemController from "./item.controller";
import { Item } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

// router.get(
//   Item.get,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   ItemController.get
// );

router.get(
  Item.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.getAll
);

router.get(
  Item.ownershipHistory,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.getOwnershipHistory
);

router.post(
  Item.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.create
);

router.post(
  Item.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.transferOwnership
)

router.put(
  Item.update,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.update
)

router.get(
  Item.audit,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.audit
)

router.get(
  Item.getRawMaterials,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ItemController.getAllRawMaterials
)

export default router;
