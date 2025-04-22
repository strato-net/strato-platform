/**
 * @fileoverview User Activity Routes Module
 * @description Defines API routes for user activity functionality in the STRATO Mercata Marketplace.
 * This module provides an endpoint to retrieve recent user activities including purchases, orders,
 * and transfers. The route allows anonymous access but still runs through the authentication
 * middleware and uses the loadDapp middleware to access blockchain data.
 */

import express from 'express';
import UserActivityController from './userActivity.controller';
import { UserActivity } from '../endpoints';
import loadDapp from '../../middleware/loadDappHandler';
import authHandler from '../../middleware/authHandler';

const router = express.Router();

/**
 * @route GET /userActivity
 * @description Retrieves the recent user activity including purchases, orders, and transfers from the last 10 days.
 * Activities are sorted by timestamp in descending order. Can be filtered by seller, purchaser, or new owner.
 * @middleware authHandler.authorizeRequest(true) - Allows anonymous access with authentication middleware
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - List of user activities
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error - Failed to retrieve user activities
 */
router.get(
  UserActivity.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  UserActivityController.getAll
);

export default router;
