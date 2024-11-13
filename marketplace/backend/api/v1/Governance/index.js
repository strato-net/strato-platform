import express from "express";
import GovernanceController from "./governance.controller";
import { Governance } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Governance.get,
  authHandler.authorizeRequest(),
  loadDapp,
  GovernanceController.get
);

router.get(
  Governance.calculate,
  authHandler.authorizeRequest(),
  loadDapp,
  GovernanceController.calculate
);

router.post(
  Governance.stake,
  authHandler.authorizeRequest(),
  loadDapp,
  GovernanceController.stake
);

router.post(
  Governance.unstake,
  authHandler.authorizeRequest(),
  loadDapp,
  GovernanceController.unstake
);

export default router;
