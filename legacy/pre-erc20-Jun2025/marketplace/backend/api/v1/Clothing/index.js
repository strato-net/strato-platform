import express from 'express';
import ClothingController from './clothing.controller';
import { Clothing } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Clothing.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ClothingController.getAll
);

router.post(
  Clothing.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ClothingController.create
);

export default router;
