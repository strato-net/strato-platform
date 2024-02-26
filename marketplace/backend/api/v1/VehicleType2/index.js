import express from "express";
import VehicleType2Controller from "./vehicleType2.controller";
import { VehicleType2 } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  VehicleType2.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  VehicleType2Controller.getAll
);

router.post(
  VehicleType2.create,
  authHandler.authorizeRequest(),
  loadDapp,
  VehicleType2Controller.create
);

export default router;
