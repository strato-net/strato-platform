import express from 'express';
import MembershipController from './membership.controller';
import { Membership } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Membership.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MembershipController.getAll
);

router.post(
  Membership.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.create
);

export default router;
