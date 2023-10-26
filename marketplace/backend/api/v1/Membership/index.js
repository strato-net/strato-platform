import express from "express";
import MembershipController from "./membership.controller";
import { Membership } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Membership.purchased,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.purchased
);

router.get(
  Membership.issued,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.issued
);

router.get(
  Membership.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  MembershipController.get
);

router.get(
  Membership.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.getAll
);

router.post(
  Membership.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.create
);

router.post(
  Membership.resale,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.resale
);

//router.post(
//  Membership.transferOwnership,
//  authHandler.authorizeRequest(),
//  loadDapp,
//  MembershipController.transferOwnership
//)
//
//router.put(
//  Membership.update,
//  authHandler.authorizeRequest(),
//  loadDapp,
//  MembershipController.update
//)

export default router;
