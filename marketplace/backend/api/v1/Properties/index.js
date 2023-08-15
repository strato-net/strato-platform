import express from "express";
import PropertiesController from "./properties.controller";
import { Properties } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import constants from "../../../helpers/constants"
import multer from "multer";

const router = express.Router();
const fileUploader = multer({ storage: multer.memoryStorage() });

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
  fileUploader.any(),
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.create
);

router.put(
  Properties.update,
  fileUploader.any(),
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.update
)

export default router;