/**
 * @fileoverview SubCategory Routes Module
 * 
 * This module defines the API routes for the subcategory functionality in the STRATO Mercata Marketplace.
 * It sets up routes for creating, retrieving, and updating subcategories which are used to organize
 * marketplace items into hierarchical categories. Each route is protected by authentication middleware
 * and uses the loadDapp middleware to access blockchain data.
 * 
 * Subcategories are organized under parent categories and help to create a structured taxonomy
 * for items in the marketplace.
 * 
 * @module api/v1/SubCategory
 * @requires express
 * @requires ./subCategory.controller
 * @requires ../endpoints
 * @requires ../../middleware/authHandler
 * @requires ../../middleware/loadDappHandler
 */

import express from 'express';
import SubCategoryController from './subCategory.controller';
import { SubCategory } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';
const router = express.Router();

/**
 * Route to get a specific subcategory by its address
 * 
 * @name GET /subcategory/{address}
 * @function
 * @memberof module:api/v1/SubCategory
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Details of the requested subcategory
 */
router.get(
  SubCategory.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  SubCategoryController.get
);

/**
 * Route to get all subcategories with optional filtering by category
 * 
 * @name GET /subcategory
 * @function
 * @memberof module:api/v1/SubCategory
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication with anonymous access allowed)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object[]} - Array of subcategories matching the query parameters
 */
router.get(
  SubCategory.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  SubCategoryController.getAll
);

/**
 * Route to create a new subcategory
 * 
 * @name POST /subcategory
 * @function
 * @memberof module:api/v1/SubCategory
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Created subcategory object
 */
router.post(
  SubCategory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  SubCategoryController.create
);

/**
 * Route to update an existing subcategory
 * 
 * @name PUT /subcategory/update
 * @function
 * @memberof module:api/v1/SubCategory
 * @inner
 * @param {string} path - Express path
 * @param {callback} middleware - Express middleware (authentication, no anonymous access)
 * @param {callback} middleware - Express middleware (loadDapp)
 * @param {callback} controller - Express controller function
 * @returns {Object} - Updated subcategory object
 */
router.put(
  SubCategory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  SubCategoryController.update
);

export default router;
