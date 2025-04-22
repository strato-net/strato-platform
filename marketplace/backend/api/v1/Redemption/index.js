/**
 * @fileoverview Redemption Routes Module
 * 
 * This module defines the API routes for the redemption functionality in the STRATO Mercata Marketplace.
 * It sets up routes for retrieving redemption services, managing redemption requests, and processing
 * redemption approvals or rejections. All routes are protected by authentication middleware
 * and use the loadDapp middleware to access blockchain data.
 * 
 * @module api/v1/Redemption
 * @requires express
 * @requires ./redemption.controller
 * @requires ../endpoints
 * @requires ../../middleware/authHandler
 * @requires ../../middleware/loadDappHandler
 */

import express from 'express';
import RedemptionController from './redemption.controller';
import { Redemption } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * Route to get all available redemption services
 * 
 * @name GET /redemption/services
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of available redemption services
 */
router.get(
  Redemption.getRedemptionServices,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getRedemptionServices
);

/**
 * Route to get outgoing redemption requests (redemptions requested by the authenticated user)
 * 
 * @name GET /redemption/outgoing
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of outgoing redemption requests
 */
router.get(
  Redemption.getOutgoingRedemptionRequests,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getOutgoingRedemptionRequests
);

/**
 * Route to get incoming redemption requests (redemptions to be approved by the authenticated user)
 * 
 * @name GET /redemption/incoming
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp) 
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of incoming redemption requests
 */
router.get(
  Redemption.getIncomingRedemptionRequests,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.getIncomingRedemptionRequests
);

/**
 * Route to get a specific redemption request by ID
 * 
 * @name GET /redemption/:id
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Details of the requested redemption
 */
router.get(
  Redemption.get,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.get
);

/**
 * Route to create a new redemption request
 * 
 * @name POST /redemption
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Details of the created redemption request
 */
router.post(
  Redemption.create,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.requestRedemption
);

/**
 * Route to close (approve or reject) a redemption request
 * 
 * @name PUT /redemption/close
 * @function
 * @memberof module:api/v1/Redemption
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Details of the closed redemption request
 */
router.put(
  Redemption.close,
  authHandler.authorizeRequest(),
  loadDapp,
  RedemptionController.closeRedemption
);

export default router;
