import express from "express";
import EventController from "./event.controller";
import { Event } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();


router.get(
  Event.getInventoryEventTypes,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.getInventoryEventTypes
);

router.get(
  Event.getInventoryEventTypeDetails,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.getInventoryEventTypeDetails
);

router.get(
  Event.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.getAll
);

router.post(
  Event.create,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.create
);

router.post(
  Event.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.transferOwnership
)

router.put(
  Event.certifyEvent,
  authHandler.authorizeRequest(),
  loadDapp,
  EventController.certifyEvent
)

router.get(
  Event.audit,
  loadDapp,
  EventController.audit
)

export default router;
