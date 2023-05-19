import express from "express";
import UsersController from "./users.controller";
import { Users } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  Users.me,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  UsersController.me
);

router.get(
  Users.get,
  authHandler.authorizeRequest(), 
  loadDapp, 
  attachMembership,
  UsersController.get
);

router.get(
  Users.getAll,
  authHandler.authorizeRequest(), 
  loadDapp, 
  attachMembership,
  UsersController.getAll
);

export default router;
