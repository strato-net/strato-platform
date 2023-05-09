import express from "express";
import UserMembershipController from "./userMembership.controller";
import { UserMembership } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  UserMembership.get,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.get
);

router.get(
  UserMembership.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.getAll
);

router.get(
  UserMembership.getAllRequestOfUser,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.getUserMembershipRequest
);
  
router.post(
  UserMembership.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.create
);

// user membership request

router.get(
  UserMembership.getAllRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.getAllUserMembershipRequests
);


router.post(
  UserMembership.createRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.createUserMembershipRequest
);

router.put(
  UserMembership.approveRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.updateUserMembershipRequest
);




router.put(
  UserMembership.update,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.update
)

router.get(
  UserMembership.getAllCertifiers,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UserMembershipController.getAllCertifiers
)


export default router;
