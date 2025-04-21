import { Router } from 'express';
import AuthenticationController from './authentication.controller';
import { Authentication } from '../endpoints';
import authHandler from '../../middleware/authHandler';

const router = Router();

router.get(Authentication.callback, AuthenticationController.callback);

router.get(
  Authentication.logout,
  authHandler.authorizeRequest(),
  AuthenticationController.logout
);

export default router;
