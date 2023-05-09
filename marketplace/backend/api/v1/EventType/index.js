import express from "express";
import EventTypeController from "./eventType.controller";
import { EventType } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  EventType.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  EventTypeController.getAll
);

router.post(
  EventType.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  EventTypeController.create
);

export default router;
