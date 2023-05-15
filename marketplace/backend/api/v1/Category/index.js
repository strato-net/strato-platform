import express from "express";
import CategoryController from "./category.controller";
import { Category } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Category.get,
  loadDapp,
  CategoryController.get
);

router.get(
  Category.getAll,
  loadDapp,
  CategoryController.getAll
);

router.post(
  Category.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CategoryController.create
);


router.put(
  Category.update,
  authHandler.authorizeRequest(),
  loadDapp,
  CategoryController.update
)


export default router;
