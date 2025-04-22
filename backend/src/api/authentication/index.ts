import { Router } from 'express';
import AuthenticationController from './authentication.controller';
import authHandler from '../../middleware/authHandler';

const router = Router();

router.get(
  '/logout',
  authHandler.authorizeRequest(),
  AuthenticationController.logout
);

export default router;
