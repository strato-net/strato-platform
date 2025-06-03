import { Router } from 'express';
import { processBridgeTransactionHandler } from '../controllers/bridgeTransactionsController';

const router = Router();

// POST /api/bridge/transaction
router.post('/transaction', processBridgeTransactionHandler);

export default router; 