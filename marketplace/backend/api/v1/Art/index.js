import express from "express";
import ArtController from "./Art.controller";
import { Art } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();


router.get(
  Art.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ArtController.getAll
);

router.get(
  Art.ownershipHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  ArtController.getOwnershipHistory
);

router.post(
  Art.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.create
);

router.post(
  Art.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.transferOwnership
)

router.put(
  Art.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.update
)

router.get(
  Art.audit,
  loadDapp,
  ArtController.audit
)

router.get(
  Art.getRawMaterials,
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.getAllRawMaterials
)

export default router;
