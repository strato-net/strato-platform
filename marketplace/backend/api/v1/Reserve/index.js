/**
 * @fileoverview Reserve Routes Module
 * 
 * This module defines the API routes for the reserve functionality in the STRATO Mercata Marketplace.
 * It sets up routes for managing reserve contracts, which are used for staking, borrowing, and repaying
 * in the DeFi ecosystem of the marketplace. Each route is protected by authentication middleware
 * and uses the loadDapp middleware to access blockchain data.
 * 
 * The Reserve system allows users to stake assets as collateral, borrow against that collateral,
 * and repay loans. It also provides information about oracle prices and rewards.
 * 
 * @module api/v1/Reserve
 * @requires express
 * @requires ./reserve.controller
 * @requires ../endpoints
 * @requires ../../middleware/authHandler
 * @requires ../../middleware/loadDappHandler
 */

import express from 'express';
import ReserveController from './reserve.controller';
import { Reserve } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * Route to fetch total CATA rewards information
 * 
 * @name GET /reserve/fetchTotalCataRewards
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - CATA rewards information including total and claimable rewards
 */
router.get(
  Reserve.fetchTotalCataRewards,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.fetchTotalCataRewards
);

/**
 * Route to get a specific reserve contract by its address
 * 
 * @name GET /reserve/{address}
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Details of the requested reserve contract
 */
router.get(
  Reserve.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.get
);

/**
 * Route to get all reserve contracts in the system
 * 
 * @name GET /reserve
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of all reserve contracts
 */
router.get(
  Reserve.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.getAll
);

/**
 * Route to get price information from an oracle
 * 
 * @name GET /reserve/oraclePrice/{address}
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Price information from the specified oracle
 */
router.get(
  Reserve.oraclePrice,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.oraclePrice
);

/**
 * Route to stake assets as collateral in a reserve
 * 
 * @name POST /reserve/stake
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Result of the staking operation
 */
router.post(
  Reserve.stake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.stake
);

/**
 * Route to stake assets after they have been bridged from another chain
 * 
 * @name POST /reserve/stakeAfterBridge
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Result of the staking operation
 */
router.post(
  Reserve.stakeAfterBridge,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.stakeAfterBridge
);

/**
 * Route to unstake assets from a reserve
 * 
 * @name POST /reserve/unstake
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Result of the unstaking operation
 */
router.post(
  Reserve.unstake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.unstake
);

/**
 * Route to borrow tokens against staked collateral
 * 
 * @name POST /reserve/borrow
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Result of the borrow operation
 */
router.post(
  Reserve.borrow,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.borrow
);

/**
 * Route to repay a loan taken from a reserve
 * 
 * @name POST /reserve/repay
 * @function
 * @memberof module:api/v1/Reserve
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Results of the repay operations
 */
router.post(
  Reserve.repay,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.repay
);

export default router;
