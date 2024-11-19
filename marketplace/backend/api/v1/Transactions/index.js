import express from 'express';
import TransactionController from './transaction.controller';
import { Transaction } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Transaction.getUser,
  authHandler.authorizeRequest(),
  loadDapp,
  TransactionController.getAllTransactions
);

router.get(
  Transaction.getGlobal,
  authHandler.authorizeRequest(true),
  loadDapp,
  TransactionController.getGlobalTransactions
);

export default router;
