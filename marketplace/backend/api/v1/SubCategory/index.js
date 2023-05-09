import express from "express";
import SubCategoryController from "./subCategory.controller";
import { SubCategory } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";
const router = express.Router();

router.get(
  SubCategory.get,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  SubCategoryController.get
);

router.get(
  SubCategory.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  SubCategoryController.getAll
);

router.post(
  SubCategory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  SubCategoryController.create
);

router.put(
  SubCategory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  SubCategoryController.update
)

export default router;
