/**
 * @fileoverview Payment Service Controller
 * 
 * This module handles the business logic for payment service management
 * in the marketplace, including retrieving all payment services and
 * fetching services that have not been onboarded yet.
 * 
 * @module api/v1/PaymentService/PaymentServiceController
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class PaymentServiceController {
  /**
   * Retrieves a list of all payment services
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {boolean} [req.query.onlyActive] - Filter to only show active payment services
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of payment services or passes error to next middleware
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { onlyActive } = query;

      const result = await dapp.getPaymentServices({ onlyActive: onlyActive });
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of payment services that have not been onboarded yet
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of payment services to return
   * @param {number} [req.query.offset] - Number of payment services to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of non-onboarded payment services or passes error to next middleware
   */
  static async getNotOnboarded(req, res, next) {
    try {
      const { dapp, query } = req;

      const result = await dapp.getNotOnboardedPaymentServices(query);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default PaymentServiceController;
