import express from "express";
import ProductFileController from "./productFile.controller";
import { ProductFile } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  ProductFile.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductFileController.get
);

router.get(
  ProductFile.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductFileController.getAll
);

router.post(
  ProductFile.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductFileController.create
);


router.put(
  ProductFile.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductFileController.update
);


export default router;
