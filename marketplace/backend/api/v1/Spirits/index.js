/**
 * @fileoverview Spirits Routes Module
 * 
 * This module defines the API routes for the spirits functionality in the STRATO Mercata Marketplace.
 * It sets up routes for creating and retrieving tokenized spirits assets on the blockchain.
 * 
 * Spirits represent alcoholic beverages like whiskey, vodka, or rum that have been tokenized
 * for trading in the marketplace. Each route is protected by authentication middleware
 * and uses the loadDapp middleware to access blockchain data.
 * 
 * @module api/v1/Spirits
 * @requires express
 * @requires ../endpoints
 * @requires ../../middleware/authHandler
 * @requires ../../middleware/loadDappHandler
 * @requires ./spirits.controller
 */

import express from 'express';
import { Spirits } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';
import SpiritsController from './spirits.controller';

const router = express.Router();

/**
 * Route to get all spirits with optional filtering
 * 
 * @name GET /spirits
 * @function
 * @memberof module:api/v1/Spirits
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of spirits matching the query parameters
 */
router.get(
  Spirits.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  SpiritsController.getAll
);

/**
 * Route to create a new spirit
 * 
 * @name POST /spirits
 * @function
 * @memberof module:api/v1/Spirits
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Created spirit object
 */
router.post(
  Spirits.create,
  authHandler.authorizeRequest(),
  loadDapp,
  SpiritsController.create
);

export default router;
