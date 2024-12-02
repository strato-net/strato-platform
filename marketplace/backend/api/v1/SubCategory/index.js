import express from 'express';
import SubCategoryController from './subCategory.controller';
import { SubCategory } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';
const router = express.Router();

router.get(
  SubCategory.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  SubCategoryController.get
);

router.get(
  SubCategory.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  SubCategoryController.getAll
);

router.post(
  SubCategory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  SubCategoryController.create
);

router.put(
  SubCategory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  SubCategoryController.update
);

export default router;
