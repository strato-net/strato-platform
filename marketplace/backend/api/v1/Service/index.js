import express from "express";
import ServiceController from "./service.controller";
import { Service } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Service.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.get
);

router.get(
  Service.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.getAll
);

router.post(
  Service.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.create
);

router.post(
  Service.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.transferOwnership
)

router.put(
  Service.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.update
)

router.get(
  Service.audit,
  authHandler.authorizeRequest(),
  loadDapp,
  ServiceController.audit
)

export default router;
