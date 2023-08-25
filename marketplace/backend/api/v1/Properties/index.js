import express from "express";
import PropertiesController from "./properties.controller";
import { Properties } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Properties.get,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.get
);

router.get(
  Properties.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.getAll
);

router.post(
  Properties.create,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.create
);

router.post(
  Properties.createReview,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.createReview
);

router.post(
  Properties.deleteReview,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.deleteReview
);

export default router;