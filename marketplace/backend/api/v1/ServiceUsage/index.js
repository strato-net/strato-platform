import express from "express";
import ServiceUsageController from "./serviceUsage.controller";
import { ServiceUsage } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  ServiceUsage.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceUsageController.get
);

router.get(
  ServiceUsage.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceUsageController.getAll
);

router.post(
  ServiceUsage.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceUsageController.create
);

router.put(
  ServiceUsage.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceUsageController.update
);

export default router;
