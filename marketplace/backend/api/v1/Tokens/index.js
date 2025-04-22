/**
 * @fileoverview Token Routes Module
 * @description Defines API routes for token functionality in the STRATO Mercata Marketplace.
 * All routes are protected by authentication middleware and utilize the loadDapp middleware
 * for accessing blockchain data. The module handles token creation, hash addition, token bridging,
 * and retrieving bridgeable tokens.
 */

import express from 'express';
import TokensController from './tokens.controller';
import { Tokens } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route POST /tokens
 * @description Creates a new token on the blockchain
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 201 - Token created successfully
 * @returns {Error} 400 - Bad request with validation errors
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.post(
  Tokens.create,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.create
);

/**
 * @route POST /tokens/addHash
 * @description Adds a transaction hash to a token
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - Hash added successfully
 * @returns {Error} 400 - Bad request with validation errors
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.post(
  Tokens.addHash,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.addHash
)

/**
 * @route POST /tokens/bridgeOut
 * @description Bridges a token from current chain to an external blockchain
 * @middleware authHandler.authorizeRequest() - Requires authentication, no anonymous access
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Object} 200 - Token bridged out successfully
 * @returns {Error} 400 - Bad request with validation errors
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.post(
  Tokens.bridgeOut,
  authHandler.authorizeRequest(),
  loadDapp,
  TokensController.bridgeOut
);

/**
 * @route GET /tokens/bridgeableTokens
 * @description Retrieves a list of tokens that can be bridged to external chains
 * @middleware authHandler.authorizeRequest(true) - Allows anonymous access with authentication middleware
 * @middleware loadDapp - Loads STRATO blockchain dapp context
 * @returns {Array} 200 - List of bridgeable token addresses
 * @returns {Error} 401 - Unauthorized
 * @returns {Error} 500 - Internal server error
 */
router.get(
  Tokens.getBridgeableTokens,
  authHandler.authorizeRequest(true),
  loadDapp,
  TokensController.getBridgeableTokens
);

export default router;
