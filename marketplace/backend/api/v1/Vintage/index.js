import express from "express";
import VintageController from "./vintage.controller";
import { Vintage } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Vintage.get,
  authHandler.authorizeRequest(),
  loadDapp,
  VintageController.get
);

router.get(
  Vintage.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  VintageController.getAll
);

router.post(
  Vintage.create,
  authHandler.authorizeRequest(),
  loadDapp,
  VintageController.create
);

export default router;