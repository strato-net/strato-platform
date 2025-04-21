import { Router } from 'express';
import UsersController from './users.controller';
import { Users } from '../endpoints';
import authHandler from '../../middleware/authHandler';

const router = Router();

router.get(
  Users.me,
  authHandler.authorizeRequest(false),
  UsersController.me
);

export default router;