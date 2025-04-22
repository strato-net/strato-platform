/**
 * @fileoverview Payment Service API routes configuration
 * 
 * This module defines all RESTful API routes for the Payment Service module,
 * which handles payment service management and retrieval operations.
 * Each route is protected by authentication middleware and uses the loadDapp
 * middleware to access blockchain data.
 * 
 * @module api/v1/PaymentService
 */

import express from 'express';
import PaymentServiceController from './paymentService.controller';
import { PaymentService } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route GET /api/v1/payment
 * @description Retrieves a list of all payment services. Can be filtered to only show active services.
 * @param {boolean} [onlyActive] - Filter to only show active payment services (query parameter)
 * @access Private - Requires authentication
 * @returns {Array<PaymentService>} List of payment services
 */
router.get(
  PaymentService.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  PaymentServiceController.getAll
);

/**
 * @route GET /api/v1/payment/onboarding
 * @description Retrieves a list of payment services that have not been onboarded yet.
 * @param {number} [limit] - Maximum number of payment services to return (query parameter)
 * @param {number} [offset] - Number of payment services to skip (query parameter)
 * @access Private - Requires authentication
 * @returns {Array<PaymentService>} List of non-onboarded payment services
 */
router.get(
  PaymentService.getNotOnboarded,
  authHandler.authorizeRequest(),
  loadDapp,
  PaymentServiceController.getNotOnboarded
);

export default router;
