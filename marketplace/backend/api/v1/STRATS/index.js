import express from "express";
import STRATSController from "./STRATS.controller";
import { STRATS } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  STRATS.getAll, // Assuming this is the correct endpoint for getting all STRATS
  authHandler.authorizeRequest(true),
  loadDapp,
  STRATSController.getAll
);

router.post(
  STRATS.create, // Assuming this is the correct endpoint for creating STRATS
  authHandler.authorizeRequest(),
  loadDapp,
  STRATSController.create
);

export default router;
