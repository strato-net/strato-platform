import express from "express";
import EventTypeController from "./eventType.controller";
import { EventType } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  EventType.getAll,
  loadDapp,
  EventTypeController.getAll
);

router.post(
  EventType.create,
  authHandler.authorizeRequest(),
  loadDapp,
  EventTypeController.create
);

export default router;
