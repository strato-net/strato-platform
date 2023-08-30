import express from "express";
import CarbonController from "./carbon.controller";
import { Carbon } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Carbon.get,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonController.get
);

router.get(
  Carbon.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonController.getAll
);

router.post(
  Carbon.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonController.create
);

export default router;