/**
 * @module CarbonDAO
 * @description API routes for CarbonDAO-related endpoints
 */
import express from 'express';
import CarbonDAOController from './carbonDAO.controller';
import { CarbonDAO } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * GET /api/v1/carbonDAO
 * @description Retrieves a list of all carbon DAOs in the system
 * @security bearerToken, oauth2 (openid, profile)
 * @param {number} [limit] - Maximum number of carbon DAOs to return
 * @param {number} [offset] - Number of carbon DAOs to skip
 * @returns {Array} 200 - List of carbon DAOs
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to access carbon DAOs
 */
router.get(
  CarbonDAO.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CarbonDAOController.getAll
);

/**
 * POST /api/v1/carbonDAO
 * @description Creates a new carbon DAO in the system
 * @security bearerToken, oauth2 (openid, profile)
 * @param {Object} requestBody - Carbon DAO creation payload
 * @param {Object} requestBody.itemArgs - Carbon DAO item arguments
 * @param {string} requestBody.itemArgs.name - Name of the carbon DAO
 * @param {string} requestBody.itemArgs.description - Detailed description of the carbon DAO
 * @param {number} requestBody.itemArgs.quantity - Quantity of carbon credits represented by this DAO (minimum: 1)
 * @param {number} requestBody.itemArgs.decimals - Number of decimal places for the carbon DAO (0-18)
 * @param {string[]} requestBody.itemArgs.images - Array of image URLs for the carbon DAO
 * @param {string[]} requestBody.itemArgs.files - Array of file URLs for the carbon DAO
 * @param {string[]} requestBody.itemArgs.fileNames - Array of file names for the carbon DAO
 * @param {string} requestBody.itemArgs.redemptionService - Service used for redeeming the carbon DAO
 * @returns {Object} 200 - Carbon DAO created successfully
 * @returns {Object} 400 - Bad Request - Invalid input data
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to create carbon DAOs
 */
router.post(
  CarbonDAO.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonDAOController.create
);

export default router;
