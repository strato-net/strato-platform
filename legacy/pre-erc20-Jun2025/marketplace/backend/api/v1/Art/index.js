import express from 'express';
import ArtController from './art.controller';
import { Art } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Art.getAll, // Assuming this is the correct endpoint for getting all arts
  authHandler.authorizeRequest(true),
  loadDapp,
  ArtController.getAll
);

router.post(
  Art.create, // Assuming this is the correct endpoint for creating an art
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.create
);

export default router;
