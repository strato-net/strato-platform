import express from 'express';
import UserActivityController from './userActivity.controller';
import { UserActivity } from '../endpoints';
import loadDapp from '../../middleware/loadDappHandler';
import authHandler from '../../middleware/authHandler';

const router = express.Router();

router.get(
  UserActivity.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  UserActivityController.getAll
);

export default router;
