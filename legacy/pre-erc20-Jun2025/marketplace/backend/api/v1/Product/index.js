import express from 'express';
import ProductController from './product.controller';
import { Product } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Product.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.get
);

router.get(
  Product.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.getAll
);

router.get(
  Product.getAllProductNames,
  authHandler.authorizeRequest(true),
  loadDapp,
  ProductController.getAllProductNames
);

router.post(
  Product.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.create
);

router.put(
  Product.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.update
);

router.put(
  Product.delete,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.delete
);

export default router;
