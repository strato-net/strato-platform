import express from 'express';
import PaymentServiceController from './paymentService.controller';
import { PaymentService } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  PaymentService.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  PaymentServiceController.getAll
);

router.get(
  PaymentService.getNotOnboarded,
  authHandler.authorizeRequest(),
  loadDapp,
  PaymentServiceController.getNotOnboarded
);

export default router;
