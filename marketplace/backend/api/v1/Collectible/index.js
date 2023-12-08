import express from "express";
import CollectibleController from "./collectible.controller";
import { Collectible } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Collectible.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CollectibleController.getAll
);

router.post(
  Collectible.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CollectibleController.create
);

export default router;
