import express from 'express';
import CarbonDAOController from './carbonDAO.controller';
import { CarbonDAO } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  CarbonDAO.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CarbonDAOController.getAll
);

router.post(
  CarbonDAO.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonDAOController.create
);

export default router;
