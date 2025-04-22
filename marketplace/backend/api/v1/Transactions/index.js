/**
 * @fileoverview Transaction Routes Module
 * @description Defines API routes for transaction functionality in the STRATO Mercata Marketplace.
 * All routes are protected by authentication middleware and utilize the loadDapp middleware
 * for accessing blockchain data. The module provides endpoints for retrieving user-specific
 * and global transaction data.
 */

import express from 'express';
import TransactionController from './transaction.controller';
import { Transaction } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route GET /transaction/user
 * @description Retrieves all transactions for the authenticated user, including orders, transfers, 
 * redemptions, stakes, and unstakes. Results can be filtered by date range, type, and search terms.
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - Transaction list with pagination metadata
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.get(
  Transaction.getUser,
  authHandler.authorizeRequest(),
  loadDapp,
  TransactionController.getAllTransactions
);

/**
 * @route GET /transaction/global
 * @description Retrieves transactions from across the platform. Results can be filtered by 
 * date range, type, and search terms. Allows anonymous access but still runs through the auth middleware.
 * @middleware authHandler.authorizeRequest(true) - Allows anonymous access with authentication middleware
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - Transaction list with pagination metadata
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.get(
  Transaction.getGlobal,
  authHandler.authorizeRequest(true),
  loadDapp,
  TransactionController.getGlobalTransactions
);

export default router;
