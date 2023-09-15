import express from "express";
import MembershipServiceController from "./membershipService.controller";
import { MembershipService } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  MembershipService.get,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipServiceController.get
);

router.get(
  MembershipService.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipServiceController.getAll
);

router.post(
  MembershipService.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipServiceController.create
);

router.post(
  MembershipService.transferOwnership,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipServiceController.transferOwnership
)

router.put(
  MembershipService.update,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipServiceController.update
)

export default router;
