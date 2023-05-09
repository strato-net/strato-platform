import express from "express";
import ProductController from "./product.controller";
import { Product } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";
import attachMembership from "../../middleware/loadMembership";

const router = express.Router();

router.get(
  Product.get,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ProductController.get
);

router.get(
  Product.getAll,
  // authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ProductController.getAll
);

router.get(
  Product.getAllProductNames,
  // authHandler.authorizeRequest(),
  loadDapp,
  ProductController.getAllProductNames
);

router.post(
  Product.create,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ProductController.create
);

// router.post(
//   Product.transferOwnership,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   ProductController.transferOwnership
// )

router.put(
  Product.update,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ProductController.update
)

router.put(
  Product.delete,
  authHandler.authorizeRequest(),
  loadDapp,
  attachMembership,
  ProductController.delete
)

// router.get(
//   Product.audit,
//   authHandler.authorizeRequest(),
//   loadDapp,
//   ProductController.audit
// )

export default router;
