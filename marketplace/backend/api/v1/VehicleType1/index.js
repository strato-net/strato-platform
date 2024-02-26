import express from "express";
import VehicleType1Controller from "./vehicleType1.controller";
import { VehicleType1 } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  VehicleType1.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  VehicleType1Controller.getAll
);

router.post(
  VehicleType1.create,
  authHandler.authorizeRequest(),
  loadDapp,
  VehicleType1Controller.create
);

export default router;
