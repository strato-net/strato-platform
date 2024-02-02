import express from "express";
import AssetGroupController from "./assetGroup.controller";
import { AssetGroup } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

// router.get(
//   AssetGroup.get,
//   authHandler.authorizeRequest(true),
//   loadDapp,
//   AssetGroupController.get
// );

// router.get(
//   AssetGroup.getAll,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   AssetGroupController.getAll
// );

router.post(
  AssetGroup.create,
  authHandler.authorizeRequest(),
  loadDapp,
  AssetGroupController.create
);


export default router;
