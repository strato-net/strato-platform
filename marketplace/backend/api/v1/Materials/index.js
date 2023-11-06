import express from "express";
import MaterialsController from "./materials.controller";
import { Materials } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Materials.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MaterialsController.getAll
);

router.post(
  Materials.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MaterialsController.create
);

export default router;
