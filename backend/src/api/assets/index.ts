import { Router } from 'express';
import AssetsController from './assets.controller';
import { Assets } from '../endpoints';
import authHandler from '../../middleware/authHandler';

const router = Router();

router.get(
  Assets.get,
  authHandler.authorizeRequest(true),
  AssetsController.get
);

router.get(
  Assets.getAll,
  authHandler.authorizeRequest(true),
  AssetsController.getAll
);

router.post(
  Assets.create,
  authHandler.authorizeRequest(),
  AssetsController.create
);

router.post(
  Assets.transfer,
  authHandler.authorizeRequest(),
  AssetsController.transfer
);

export default router;
