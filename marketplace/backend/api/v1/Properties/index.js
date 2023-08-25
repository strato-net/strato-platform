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

router.put(
  Properties.update,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.update);
  
//Review specific routes
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

router.updateReview(
  Properties.updateReview,
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.updateReview
);

export default router;