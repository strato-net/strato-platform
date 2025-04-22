/**
 * @fileoverview User Routes Module
 * @description Defines API routes for user functionality in the STRATO Mercata Marketplace.
 * All routes are protected by authentication middleware and utilize the loadDapp middleware
 * for accessing blockchain data. The module provides endpoints for retrieving the current
 * user's profile, getting a specific user by address, and listing all users.
 */

import express from 'express';
import UsersController from './users.controller';
import { Users } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route GET /users/me
 * @description Retrieves the profile of the authenticated user with details from their token and blockchain certificate.
 * The profile includes user's blockchain address, common name, certificate address, email, and issuer status.
 * @middleware authHandler.authorizeRequest(false) - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - User profile with blockchain and token information
 * @returns {Error} 400 - Bad Request - User not found in blockchain
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.get(
  Users.me,
  authHandler.authorizeRequest(false),
  loadDapp,
  UsersController.me
);

/**
 * @route GET /users/:address
 * @description Retrieves a user's certificate by their blockchain address.
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - User certificate information
 * @returns {Error} 404 - Not Found - User with specified address not found
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.get(
  Users.get,
  authHandler.authorizeRequest(),
  loadDapp,
  UsersController.get
);

/**
 * @route GET /users
 * @description Retrieves certificates for all users. Parameters can be passed in query string to filter results.
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Array} 200 - List of user certificates
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error - Failed to retrieve users
 */
router.get(
  Users.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  UsersController.getAll
);

export default router;
