import express from "express";
import ImageController from "./image.controller";
import { Image } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import constants from "../../../helpers/constants"
import multer from "multer";
const router = express.Router();
const fileUploader = multer({ storage: multer.memoryStorage() });

router.post(
  Image.upload,
  fileUploader.single(constants.fileUploadFieldName),
  authHandler.authorizeRequest(),
  loadDapp,
  ImageController.uploadImage
);

router.put(
  Image.update,
  fileUploader.single(constants.fileUploadFieldName),
  authHandler.authorizeRequest(),
  loadDapp,
  ImageController.updateImage
);

router.put(
  Image.delete,
  fileUploader.single(constants.fileUploadFieldName),
  authHandler.authorizeRequest(),
  loadDapp,
  ImageController.deleteImage
);




export default router;
