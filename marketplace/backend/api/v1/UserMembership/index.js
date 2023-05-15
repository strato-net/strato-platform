import express from "express";
import UserMembershipController from "./userMembership.controller";
import { UserMembership } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  UserMembership.get,
  loadDapp,
  UserMembershipController.get
);

router.get(
  UserMembership.getAll,
  loadDapp,
  UserMembershipController.getAll
);

router.get(
  UserMembership.getAllRequestOfUser,
  authHandler.authorizeRequest(),
  loadDapp,
  UserMembershipController.getUserMembershipRequest
);
  
router.post(
  UserMembership.create,
  authHandler.authorizeRequest(),
  loadDapp,
  UserMembershipController.create
);

// user membership request

router.get(
  UserMembership.getAllRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  UserMembershipController.getAllUserMembershipRequests
);


router.post(
  UserMembership.createRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  UserMembershipController.createUserMembershipRequest
);

router.put(
  UserMembership.approveRequest,
  authHandler.authorizeRequest(),
  loadDapp,
  UserMembershipController.updateUserMembershipRequest
);




router.put(
  UserMembership.update,
  authHandler.authorizeRequest(),
  loadDapp,
  // attachMembership,
  UserMembershipController.update
)

router.get(
  UserMembership.getAllCertifiers,
  loadDapp,
  UserMembershipController.getAllCertifiers
)


export default router;
