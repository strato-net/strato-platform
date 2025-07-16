import express from 'express';
import CategoryController from './category.controller';
import { Category } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Category.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  CategoryController.get
);

router.get(
  Category.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CategoryController.getAll
);

export default router;
