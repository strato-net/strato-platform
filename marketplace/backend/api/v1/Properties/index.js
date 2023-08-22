import express from "express";
import PropertiesController from "./properties.controller";
import { Properties } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import multer from "multer";
import constants from "../../../helpers/constants";

const fileUploader = multer({ storage: multer.memoryStorage() });
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
  fileUploader.array(constants.fileUploadFieldName),
  authHandler.authorizeRequest(),
  loadDapp,
  PropertiesController.create
);

export default router;