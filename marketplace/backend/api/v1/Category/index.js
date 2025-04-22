/**
 * @module Category
 * @description API routes for Category-related endpoints
 */
import express from 'express';
import CategoryController from './category.controller';
import { Category } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * GET /api/v1/category/:address
 * @description Retrieves a specific category by its blockchain address
 * @security bearerToken, oauth2 (openid, profile)
 * @param {string} address - Blockchain address of the category
 * @returns {Object} 200 - Category details
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to access this category
 * @returns {Object} 404 - Not Found - Category with the specified address does not exist
 */
router.get(
  Category.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  CategoryController.get
);

/**
 * GET /api/v1/category
 * @description Retrieves a list of all categories in the system
 * @security bearerToken, oauth2 (openid, profile)
 * @returns {Array} 200 - List of categories
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to access categories
 */
router.get(
  Category.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CategoryController.getAll
);

export default router;
