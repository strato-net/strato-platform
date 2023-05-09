import express from "express";
import CategoryController from "./category.controller";
import { Category } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  Category.get,
  // authHandler.authorizeRequest(),
  loadDapp,
  CategoryController.get
);

router.get(
  Category.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  CategoryController.getAll
);

router.post(
  Category.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  CategoryController.create
);


router.put(
  Category.update,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  CategoryController.update
)


export default router;
