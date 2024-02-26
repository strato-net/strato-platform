import express from "express";
import VehicleController from "./vehicle.controller";
import { Vehicle } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Vehicle.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  VehicleController.getAll
);

router.post(
  Vehicle.create,
  authHandler.authorizeRequest(),
  loadDapp,
  VehicleController.create
);

export default router;
