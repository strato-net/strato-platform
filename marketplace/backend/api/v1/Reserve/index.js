import express from "express";
import ReserveController from "./reserve.controller";
import { Reserve } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Reserve.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.get
);

router.post(
  Reserve.calculate,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.calculate
);

router.post(
  Reserve.stake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.stake
);

router.post(
  Reserve.unstake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.unstake
);

export default router;
